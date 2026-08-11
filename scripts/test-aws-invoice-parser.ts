import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AwsInvoiceSchema } from '@cashight/domain/aws-invoices';
import { parseAwsInvoicePdf } from '@cashight/domain/parsers/aws-invoice';

const prohibitedKeys = new Set([
  'billTo',
  'address',
  'invoiceNumber',
  'accountId',
  'accountLabel',
  'rawText',
  'objectKey',
]);

function containsProhibitedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProhibitedKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => prohibitedKeys.has(key) || containsProhibitedKey(child),
  );
}

function cents(value: number): number {
  return Math.round(value * 100);
}

async function main(): Promise<void> {
  const fixturePath = process.env.AWS_INVOICE_FIXTURE;
  if (!fixturePath) {
    throw new Error('AWS_INVOICE_FIXTURE is required.');
  }

  const buffer = await readFile(fixturePath);
  const invoice = AwsInvoiceSchema.parse(
    await parseAwsInvoicePdf(buffer, {
      sha256: createHash('sha256').update(buffer).digest('hex'),
      uploadedAt: new Date().toISOString(),
    }),
  );

  const serviceCharges = invoice.services.reduce(
    (total, service) => total + cents(service.charges),
    0,
  );
  const serviceTax = invoice.services.reduce(
    (total, service) => total + cents(service.tax),
    0,
  );
  const accountTotal = invoice.linkedAccounts.reduce(
    (total, account) => total + cents(account.total),
    0,
  );
  const reconciled =
    serviceCharges === cents(invoice.totals.charges) &&
    serviceTax === cents(invoice.totals.tax) &&
    accountTotal === cents(invoice.totals.amountDue);

  if (!reconciled || containsProhibitedKey(invoice)) {
    throw new Error('AWS invoice structural verification failed.');
  }

  console.log(`Parser: ${invoice.source.parserId} v${invoice.source.parserVersion}`);
  console.log(`Billing month: ${invoice.billingPeriod.start.slice(0, 7)}`);
  console.log(`Currency: ${invoice.currency}`);
  console.log(`Services: ${invoice.services.length}`);
  console.log(`Linked accounts: ${invoice.linkedAccounts.length}`);
  console.log('Reconciliation: PASS');
  console.log('Prohibited-field scan: PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown failure';
  console.error(`AWS invoice parser verification failed: ${message}`);
  process.exitCode = 1;
});
