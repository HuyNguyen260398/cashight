import { describe, expect, it } from 'vitest';
import {
  AwsInvoiceDashboardSchema,
  AwsInvoiceErrorCodeSchema,
  AwsInvoiceMetadataSchema,
  AwsInvoiceSchema,
  AwsInvoiceSummaryPayloadSchema,
  AwsInvoiceUploadJobSchema,
  YearMonthSchema,
} from '@cashight/domain/aws-invoices';

const validInvoice = {
  seller: 'Amazon Web Services, Inc.' as const,
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD' as const,
  totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
  services: [{ name: 'Example Service', charges: 100, tax: 10, total: 110 }],
  linkedAccounts: [
    {
      accountLast4: '1234',
      charges: 100,
      credits: 0,
      tax: 10,
      total: 110,
      services: [
        { name: 'Example Service', charges: 100, tax: 10, total: 110 },
      ],
    },
  ],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: 'a'.repeat(64),
    uploadedAt: '2026-08-03T00:00:00.000Z',
  },
};

describe('AwsInvoiceSchema', () => {
  it('accepts the privacy-safe persisted invoice contract', () => {
    const invoice = AwsInvoiceSchema.parse(validInvoice);

    expect(invoice.totals.amountDue).toBe(110);
  });

  it.each([
    ['billTo', 'Private customer'],
    ['address', 'Private street'],
    ['invoiceNumber', 'INV-PRIVATE'],
    ['accountId', '123456789012'],
    ['accountLabel', 'Private account'],
    ['rawText', 'Private PDF text'],
  ])('rejects prohibited top-level field %s', (field, value) => {
    expect(() => AwsInvoiceSchema.parse({ ...validInvoice, [field]: value })).toThrow();
  });

  it.each([
    ['services', 'rawText'],
    ['services', 'accountId'],
    ['linkedAccounts', 'accountId'],
    ['linkedAccounts', 'accountLabel'],
    ['linkedAccounts', 'rawText'],
  ])('rejects prohibited field %s[].%s', (collection, field) => {
    const original = validInvoice[collection as 'services' | 'linkedAccounts'];
    const candidate = {
      ...validInvoice,
      [collection]: [{ ...original[0], [field]: 'private-value' }],
    };

    expect(() => AwsInvoiceSchema.parse(candidate)).toThrow();
  });

  it('rejects prohibited fields in linked-account service rows', () => {
    const candidate = {
      ...validInvoice,
      linkedAccounts: [
        {
          ...validInvoice.linkedAccounts[0],
          services: [
            {
              ...validInvoice.linkedAccounts[0].services[0],
              rawText: 'Private PDF text',
            },
          ],
        },
      ],
    };

    expect(() => AwsInvoiceSchema.parse(candidate)).toThrow();
  });

  it.each([
    ['three decimal places', 1.001],
    ['non-finite', Number.POSITIVE_INFINITY],
    ['negative tax', -0.01],
  ])('rejects invalid money: %s', (_label, tax) => {
    expect(() =>
      AwsInvoiceSchema.parse({
        ...validInvoice,
        totals: { ...validInvoice.totals, tax },
      }),
    ).toThrow();
  });

  it('requires nonnegative credits and at least one billed service', () => {
    expect(() =>
      AwsInvoiceSchema.parse({
        ...validInvoice,
        totals: { ...validInvoice.totals, credits: -1 },
      }),
    ).toThrow();
    expect(() => AwsInvoiceSchema.parse({ ...validInvoice, services: [] })).toThrow();
  });

  it('rejects invalid calendar dates and reversed billing periods', () => {
    expect(() =>
      AwsInvoiceSchema.parse({ ...validInvoice, invoiceDate: '2026-02-30' }),
    ).toThrow();
    expect(() =>
      AwsInvoiceSchema.parse({
        ...validInvoice,
        billingPeriod: { start: '2026-07-31', end: '2026-07-01' },
      }),
    ).toThrow();
  });

  it('requires a four-digit account mask and strict source metadata', () => {
    expect(() =>
      AwsInvoiceSchema.parse({
        ...validInvoice,
        linkedAccounts: [
          { ...validInvoice.linkedAccounts[0], accountLast4: '12345' },
        ],
      }),
    ).toThrow();
    expect(() =>
      AwsInvoiceSchema.parse({
        ...validInvoice,
        source: { ...validInvoice.source, objectKey: 'private/key' },
      }),
    ).toThrow();
  });
});

describe('invoice boundary contracts', () => {
  it.each(['2026-01', '2026-12'])('accepts valid month ID %s', (value) => {
    expect(YearMonthSchema.parse(value)).toBe(value);
  });

  it.each(['2026-00', '2026-13', '2026-1', '../2026-01', '2026-01/more']) (
    'rejects invalid month ID %s',
    (value) => {
      expect(() => YearMonthSchema.parse(value)).toThrow();
    },
  );

  it('accepts strict internal metadata without invoice identity fields', () => {
    const metadata = AwsInvoiceMetadataSchema.parse({
      yearMonth: '2026-07',
      objectKey: 'users/primary/aws-invoices/2026/2026-07.json',
      currency: 'USD',
      amountDue: 110,
      sha256: 'a'.repeat(64),
      parserId: 'aws-inc-consolidated-usd',
      parserVersion: 1,
      tax: 10,
      serviceCount: 1,
      linkedAccountCount: 1,
      uploadedAt: '2026-08-03T00:00:00.000Z',
    });

    expect(metadata.yearMonth).toBe('2026-07');
    expect(() =>
      AwsInvoiceMetadataSchema.parse({ ...metadata, invoiceNumber: 'private' }),
    ).toThrow();
  });

  it('accepts exact upload job states and a month-only conflict', () => {
    const job = AwsInvoiceUploadJobSchema.parse({
      jobId: '8193504f-8e42-43a4-b780-061601a02572',
      documentType: 'AWS_INVOICE',
      owner: { workspaceId: 'primary' },
      state: 'CONFLICT',
      force: false,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:01:00.000Z',
      expiresAt: 1_786_000_000,
      errorCode: 'INVOICE_CONFLICT',
      conflict: { year: 2026, month: 7 },
    });

    expect(job.conflict).toEqual({ year: 2026, month: 7 });
    expect(() =>
      AwsInvoiceUploadJobSchema.parse({
        ...job,
        conflict: { year: 2026, month: 7, invoiceNumber: 'private' },
      }),
    ).toThrow();
  });

  it('defines only the approved invoice error codes', () => {
    expect(AwsInvoiceErrorCodeSchema.options).toEqual([
      'UNSUPPORTED_AWS_INVOICE',
      'INVOICE_TOTAL_MISMATCH',
      'INVOICE_CONFLICT',
      'INVALID_PDF',
      'CHECKSUM_MISMATCH',
    ]);
  });

  it('accepts precomputed dashboard arrays and rejects extra fields', () => {
    const dashboard = AwsInvoiceDashboardSchema.parse({
      selected: validInvoice,
      yearMonth: '2026-07',
      kpis: {
        amountDue: 110,
        serviceCharges: 100,
        credits: 0,
        tax: 10,
        linkedAccountCount: 1,
        billedServiceCount: 1,
      },
      serviceBreakdown: [{ name: 'Example Service', value: 110, percentage: 100 }],
      topServices: [{ name: 'Example Service', value: 110, percentage: 100 }],
      chargeComposition: [
        { name: 'Charges', value: 100 },
        { name: 'Credits', value: 0 },
        { name: 'Tax', value: 10 },
      ],
      accountAllocations: [{ accountLast4: '1234', value: 110, percentage: 100 }],
      monthlyTrend: [{ yearMonth: '2026-07', value: 110 }],
      serviceDetails: validInvoice.services,
    });

    expect(dashboard.monthlyTrend).toEqual([{ yearMonth: '2026-07', value: 110 }]);
    expect(() =>
      AwsInvoiceDashboardSchema.parse({ ...dashboard, invoiceNumber: 'private' }),
    ).toThrow();
  });

  it('accepts only aggregate-only AI summary data', () => {
    const payload = AwsInvoiceSummaryPayloadSchema.parse({
      yearMonth: '2026-07',
      currency: 'USD',
      totals: validInvoice.totals,
      monthOverMonth: { amount: 10, percentage: 10 },
      topServices: [{ name: 'Example Service', amount: 110, percentage: 100 }],
      accountAllocations: [{ percentage: 100 }],
      taxRatio: 9.09,
    });

    expect(payload.accountAllocations).toEqual([{ percentage: 100 }]);
    expect(() =>
      AwsInvoiceSummaryPayloadSchema.parse({ ...payload, accountLast4: '1234' }),
    ).toThrow();
  });
});
