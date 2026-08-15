import { describe, expect, it } from 'vitest';
import type { AwsInvoice, AwsInvoiceMetadata } from '@cashight/domain/aws-invoices';
import { buildAwsInvoiceSummaryPayload } from '@cashight/domain/aws-invoice-summary-payload';

const sentinels = [
  'PRIVATE_BILL_TO',
  'PRIVATE_ADDRESS',
  'PRIVATE_INVOICE_ID',
  '123456789012',
  'PRIVATE_ACCOUNT_LABEL',
  'PRIVATE_RAW_TEXT',
  'users/primary/aws-invoices/private.json',
  'f'.repeat(64),
  '1234',
];

const invoice = {
  seller: 'Amazon Web Services, Inc.',
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD',
  totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
  services: [
    {
      name: 'Example Compute',
      charges: 60,
      tax: 6,
      total: 66,
      rawText: 'PRIVATE_RAW_TEXT',
    },
    { name: 'Example Storage', charges: 40, tax: 4, total: 44 },
  ],
  linkedAccounts: [
    {
      accountLast4: '1234',
      charges: 100,
      credits: 0,
      tax: 10,
      total: 110,
      accountId: '123456789012',
      accountLabel: 'PRIVATE_ACCOUNT_LABEL',
      services: [{ name: 'Example Compute', charges: 100, tax: 10, total: 110 }],
    },
  ],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: 'f'.repeat(64),
    uploadedAt: '2026-08-03T00:00:00.000Z',
  },
  billTo: 'PRIVATE_BILL_TO',
  address: 'PRIVATE_ADDRESS',
  invoiceNumber: 'PRIVATE_INVOICE_ID',
  objectKey: 'users/primary/aws-invoices/private.json',
} as unknown as AwsInvoice;

function metadata(yearMonth: string, amountDue: number): AwsInvoiceMetadata {
  return {
    yearMonth,
    objectKey: `users/primary/aws-invoices/${yearMonth.slice(0, 4)}/${yearMonth}.json`,
    currency: 'USD',
    amountDue,
    tax: 1,
    serviceCount: 1,
    linkedAccountCount: 1,
    sha256: 'a'.repeat(64),
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    uploadedAt: '2026-08-03T00:00:00.000Z',
  };
}

describe('buildAwsInvoiceSummaryPayload', () => {
  it('returns exact aggregate-only cost drivers and month-over-month values', () => {
    const payload = buildAwsInvoiceSummaryPayload(invoice, [
      metadata('2026-06', 100),
      metadata('2026-05', 80),
    ]);

    expect(payload).toEqual({
      yearMonth: '2026-07',
      currency: 'USD',
      totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
      monthOverMonth: { amount: 10, percentage: 10 },
      topServices: [
        { name: 'Example Compute', amount: 66, percentage: 60 },
        { name: 'Example Storage', amount: 44, percentage: 40 },
      ],
      accountAllocations: [{ percentage: 100 }],
      taxRatio: 9.09,
    });
  });

  it('excludes every prohibited source sentinel recursively', () => {
    const serialized = JSON.stringify(buildAwsInvoiceSummaryPayload(invoice, []));

    for (const sentinel of sentinels) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('handles zero denominators and absent history without non-finite numbers', () => {
    const payload = buildAwsInvoiceSummaryPayload(
      {
        ...invoice,
        totals: { charges: 0, credits: 0, tax: 0, amountDue: 0 },
        services: [{ name: 'Free Tier', charges: 0, tax: 0, total: 0 }],
        linkedAccounts: [{
          accountLast4: '9999',
          charges: 0,
          credits: 0,
          tax: 0,
          total: 0,
          services: [{ name: 'Free Tier', charges: 0, tax: 0, total: 0 }],
        }],
      },
      [],
    );

    expect(payload.monthOverMonth).toBeUndefined();
    expect(payload.topServices[0].percentage).toBe(0);
    expect(payload.accountAllocations[0].percentage).toBe(0);
    expect(payload.taxRatio).toBe(0);
  });
});
