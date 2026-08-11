import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { extractPdfLayout } = vi.hoisted(() => ({
  extractPdfLayout: vi.fn(),
}));

vi.mock('@cashight/domain/parsers/pdf-layout', () => ({
  extractPdfLayout,
}));

import { AwsInvoiceSchema } from '@cashight/domain/aws-invoices';
import {
  UnsupportedAwsInvoiceError,
  parseAwsInvoicePdf,
} from '@cashight/domain/parsers/aws-invoice';

const prohibitedKeys = new Set([
  'billTo',
  'address',
  'invoiceNumber',
  'accountId',
  'accountLabel',
  'rawText',
  'objectKey',
]);

function scanKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(scanKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(prohibitedKeys.has(key) ? [key] : []),
    ...scanKeys(child),
  ]);
}

describe('parseAwsInvoicePdf', () => {
  beforeEach(() => {
    extractPdfLayout.mockReset();
  });

  it('extracts positioned rows exactly once before registry dispatch', async () => {
    extractPdfLayout.mockResolvedValue([]);
    const buffer = Buffer.from('%PDF synthetic');

    await expect(
      parseAwsInvoicePdf(buffer, {
        sha256: 'c'.repeat(64),
        uploadedAt: '2026-08-03T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(UnsupportedAwsInvoiceError);
    expect(extractPdfLayout).toHaveBeenCalledTimes(1);
    expect(extractPdfLayout).toHaveBeenCalledWith(buffer);
  });
});

const fixturePath = process.env.AWS_INVOICE_FIXTURE;
const fixtureTest = fixturePath ? it : it.skip;

describe('private AWS invoice fixture', () => {
  fixtureTest('parses, reconciles, validates, and excludes prohibited keys', async () => {
    const buffer = await readFile(fixturePath!);
    const invoice = AwsInvoiceSchema.parse(
      await parseAwsInvoicePdf(buffer, {
        sha256: createHash('sha256').update(buffer).digest('hex'),
        uploadedAt: '2026-08-03T00:00:00.000Z',
      }),
    );

    const serviceCharges = invoice.services.reduce(
      (total, service) => total + Math.round(service.charges * 100),
      0,
    );
    const serviceTax = invoice.services.reduce(
      (total, service) => total + Math.round(service.tax * 100),
      0,
    );
    const accountTotal = invoice.linkedAccounts.reduce(
      (total, account) => total + Math.round(account.total * 100),
      0,
    );

    expect(serviceCharges).toBe(Math.round(invoice.totals.charges * 100));
    expect(serviceTax).toBe(Math.round(invoice.totals.tax * 100));
    expect(accountTotal).toBe(Math.round(invoice.totals.amountDue * 100));
    expect(scanKeys(invoice)).toEqual([]);
  });
});
