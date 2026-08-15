import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwsInvoice } from '@cashight/domain/aws-invoices';

import {
  collectAwsInvoiceSummaryResponse,
  prepareAwsInvoiceSummary,
  type AwsInvoiceSummaryDependencies,
} from '../functions/aws-invoice-summary-api/handler';
import { buildAwsInvoicePrompt } from '../functions/aws-invoice-summary-api/prompt';
import type { AwsInvoiceMetadataRecord } from '../shared/metadata';

const ACCOUNT_LAST4 = '1234';
const SHA256 = 'f'.repeat(64);

const authorization = {
  PK: 'AUTHZ#user-123' as const,
  SK: 'PROFILE' as const,
  active: true as const,
  workspaceId: 'primary' as const,
  authProvider: 'COGNITO' as const,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const invoice = {
  seller: 'Amazon Web Services, Inc.',
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD',
  totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
  services: [{ name: 'Example Compute', charges: 100, tax: 10, total: 110 }],
  linkedAccounts: [{
    accountLast4: ACCOUNT_LAST4,
    charges: 100,
    credits: 0,
    tax: 10,
    total: 110,
    services: [{ name: 'Example Compute', charges: 100, tax: 10, total: 110 }],
  }],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: SHA256,
    uploadedAt: '2026-08-03T00:00:00.000Z',
  },
} satisfies AwsInvoice;

const metadata: AwsInvoiceMetadataRecord = {
  PK: 'WORKSPACE#primary',
  SK: 'AWS_INVOICE#2026-07',
  yearMonth: '2026-07',
  objectKey: 'users/primary/aws-invoices/2026/2026-07.json',
  currency: 'USD',
  amountDue: 110,
  tax: 10,
  serviceCount: 1,
  linkedAccountCount: 1,
  sha256: SHA256,
  parserId: 'aws-inc-consolidated-usd',
  parserVersion: 1,
  uploadedAt: '2026-08-03T00:00:00.000Z',
};

async function* stream(): AsyncGenerator<string> {
  yield 'First. ';
  yield 'Second.';
}

async function* quotaStream(): AsyncGenerator<string> {
  throw new Error('429 RESOURCE_EXHAUSTED');
  yield '';
}

function deps(
  overrides: Partial<AwsInvoiceSummaryDependencies> = {},
): AwsInvoiceSummaryDependencies {
  return {
    getAuthorizedUser: vi.fn().mockResolvedValue(authorization),
    getMetadata: vi.fn().mockResolvedValue(metadata),
    queryMetadata: vi.fn().mockResolvedValue({ items: [metadata], nextCursor: null }),
    getInvoiceObject: vi.fn().mockResolvedValue(invoice),
    getApiKey: vi.fn().mockResolvedValue('gemini-key'),
    generateStream: vi.fn().mockImplementation(() => stream()),
    ...overrides,
  };
}

function event(body: unknown, scope = 'cashight/read cashight/write'): unknown {
  return {
    httpMethod: 'POST',
    path: '/aws/invoices/summaries',
    body: JSON.stringify(body),
    requestContext: {
      requestId: 'request-123',
      authorizer: {
        claims: { sub: 'user-123', token_use: 'access', scope },
      },
    },
  };
}

describe('AWS invoice summary API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts only a selected month and loads owned aggregates server-side', async () => {
    const local = deps();
    const result = await prepareAwsInvoiceSummary(event({ yearMonth: '2026-07' }), local);

    expect(result.type).toBe('stream');
    expect(local.getMetadata).toHaveBeenCalledWith('primary', '2026-07');
    expect(local.getInvoiceObject).toHaveBeenCalledWith(metadata.objectKey);
    expect(local.generateStream).toHaveBeenCalledWith(expect.any(String), 'gemini-key');
  });

  it.each([
    {},
    { yearMonth: '../private' },
    { yearMonth: '2026-07', totals: { amountDue: 1 } },
  ])('rejects invalid or client-supplied aggregate body %#', async (body) => {
    const result = await prepareAwsInvoiceSummary(event(body), deps());

    expect(result.type).toBe('error');
    if (result.type === 'error') expect(result.response.statusCode).toBe(400);
  });

  it('never includes invoice identity, account mask, hash, or object key in the prompt', async () => {
    let prompt = '';
    const result = await prepareAwsInvoiceSummary(
      event({ yearMonth: '2026-07' }),
      deps({
        generateStream: vi.fn().mockImplementation((value: string) => {
          prompt = value;
          return stream();
        }),
      }),
    );

    expect(result.type).toBe('stream');
    for (const prohibited of [
      ACCOUNT_LAST4,
      SHA256,
      metadata.objectKey,
    ]) {
      expect(prompt).not.toContain(prohibited);
    }
  });

  it('rejects a persisted object containing prohibited identity fields before Gemini', async () => {
    const generateStream = vi.fn().mockImplementation(() => stream());
    const result = await prepareAwsInvoiceSummary(
      event({ yearMonth: '2026-07' }),
      deps({
        getInvoiceObject: vi.fn().mockResolvedValue({
          ...invoice,
          billTo: 'PRIVATE_BILL_TO_SENTINEL',
        }),
        generateStream,
      }),
    );

    expect(result.type).toBe('error');
    if (result.type === 'error') expect(result.response.statusCode).toBe(500);
    expect(generateStream).not.toHaveBeenCalled();
  });

  it('maps missing config, rate limits, and upstream errors', async () => {
    const missing = await prepareAwsInvoiceSummary(
      event({ yearMonth: '2026-07' }),
      deps({ getApiKey: vi.fn().mockResolvedValue(undefined) }),
    );
    const limited = await prepareAwsInvoiceSummary(
      event({ yearMonth: '2026-07' }),
      deps({ generateStream: vi.fn().mockImplementation(() => quotaStream()) }),
    );
    const upstream = await prepareAwsInvoiceSummary(
      event({ yearMonth: '2026-07' }),
      deps({
        generateStream: vi.fn().mockImplementation(() => (async function* () {
          throw new Error('upstream failed');
          yield '';
        })()),
      }),
    );

    expect(missing.type === 'error' && missing.response.statusCode).toBe(503);
    expect(limited.type === 'error' && limited.response.statusCode).toBe(429);
    expect(upstream.type === 'error' && upstream.response.statusCode).toBe(500);
  });

  it('buffers all response chunks for API Gateway', async () => {
    const result = await prepareAwsInvoiceSummary(
      event({ yearMonth: '2026-07' }),
      deps(),
    );
    const response = await collectAwsInvoiceSummaryResponse(result);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('First. Second.');
  });

  it('builds instructions that prohibit invented causes and account details', () => {
    const prompt = buildAwsInvoicePrompt({
      yearMonth: '2026-07',
      currency: 'USD',
      totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
      topServices: [{ name: 'Example Compute', amount: 110, percentage: 100 }],
      accountAllocations: [{ percentage: 100 }],
      taxRatio: 9.09,
    });

    expect(prompt).toContain('Do not invent');
    expect(prompt).toContain('aggregates');
    expect(prompt).toContain('review questions');
  });
});
