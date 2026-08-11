import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwsInvoice } from '@cashight/domain/aws-invoices';
import {
  InvoiceTotalMismatchError,
  UnsupportedAwsInvoiceError,
} from '@cashight/domain/parsers/aws-invoice';

import {
  createInvoiceProcessJob,
  type InvoiceProcessJobDependencies,
} from '../functions/invoice-parser-worker/process-job';
import {
  createInvoiceParserWorkerHandler,
  emitAwsInvoiceParseFailureMetric,
  type InvoiceQueueRecord,
} from '../functions/invoice-parser-worker/handler';
import type { AwsInvoiceUploadJobRecord } from '../shared/metadata';

const JOB_ID = '8193504f-8e42-43a4-b780-061601a02572';
const CLAIM_ID = '5f9ff915-c53f-485a-af84-9cb81ad3c8cd';
const KEY = `uploads/aws-invoices/primary/${JOB_ID}.pdf`;
const SHA256 = 'a'.repeat(64);
const PDF = Buffer.from('%PDF-1.7 synthetic');

const invoice: AwsInvoice = {
  seller: 'Amazon Web Services, Inc.',
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD',
  totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
  services: [{ name: 'Example Service', charges: 100, tax: 10, total: 110 }],
  linkedAccounts: [
    {
      accountLast4: '1234',
      charges: 100,
      credits: 0,
      tax: 10,
      total: 110,
      services: [{ name: 'Example Service', charges: 100, tax: 10, total: 110 }],
    },
  ],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: SHA256,
    uploadedAt: '2026-08-03T12:00:00.000Z',
  },
};

const job: AwsInvoiceUploadJobRecord = {
  PK: `JOB#${JOB_ID}`,
  SK: 'METADATA',
  documentType: 'AWS_INVOICE',
  owner: { workspaceId: 'primary', subject: 'user-123' },
  state: 'PENDING_UPLOAD',
  sha256: SHA256,
  force: false,
  createdAt: '2026-08-03T12:00:00.000Z',
  updatedAt: '2026-08-03T12:00:00.000Z',
  expiresAtEpoch: 1_786_000_000,
};

function makeDeps(
  overrides: Partial<InvoiceProcessJobDependencies> = {},
): InvoiceProcessJobDependencies {
  return {
    getJobRecord: vi.fn().mockResolvedValue(job),
    claimJob: vi.fn().mockResolvedValue('claimed'),
    transitionToTerminal: vi.fn().mockResolvedValue(undefined),
    downloadPdf: vi.fn().mockResolvedValue(PDF),
    deletePdf: vi.fn().mockResolvedValue(undefined),
    computeSha256: vi.fn().mockResolvedValue(SHA256),
    parsePdf: vi.fn().mockResolvedValue(invoice),
    getMetadata: vi.fn().mockResolvedValue(undefined),
    getDestinationInvoice: vi.fn().mockResolvedValue(undefined),
    writeInvoice: vi.fn().mockResolvedValue(undefined),
    writeMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('invoice parser job', () => {
  let deps: InvoiceProcessJobDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
  });

  it.each([
    `uploads/statements/primary/${JOB_ID}.pdf`,
    'uploads/aws-invoices/other/8193504f-8e42-43a4-b780-061601a02572.pdf',
    'uploads/aws-invoices/primary/not-a-uuid.pdf',
    `uploads/aws-invoices/primary/${JOB_ID}.pdf/more`,
  ])('rejects an isolated-queue key outside the exact prefix: %s', async (key) => {
    await expect(createInvoiceProcessJob(deps)(key, CLAIM_ID)).rejects.toThrow();
    expect(deps.getJobRecord).not.toHaveBeenCalled();
  });

  it('rejects missing, wrong-document, and foreign-owner jobs before download', async () => {
    for (const record of [
      undefined,
      { ...job, documentType: 'STATEMENT' },
      { ...job, owner: { workspaceId: 'other', subject: 'other' } },
    ]) {
      const local = makeDeps({ getJobRecord: vi.fn().mockResolvedValue(record) });
      await expect(createInvoiceProcessJob(local)(KEY, CLAIM_ID)).rejects.toThrow();
      expect(local.downloadPdf).not.toHaveBeenCalled();
    }
  });

  it('does not process a claim held by a different SQS delivery', async () => {
    deps = makeDeps({ claimJob: vi.fn().mockResolvedValue('duplicate') });

    await createInvoiceProcessJob(deps)(KEY, CLAIM_ID);

    expect(deps.downloadPdf).not.toHaveBeenCalled();
    expect(deps.deletePdf).not.toHaveBeenCalled();
  });

  it('cleans up an already-terminal delivery without reparsing it', async () => {
    deps = makeDeps({ claimJob: vi.fn().mockResolvedValue('already_terminal') });

    await createInvoiceProcessJob(deps)(KEY, CLAIM_ID);

    expect(deps.parsePdf).not.toHaveBeenCalled();
    expect(deps.deletePdf).toHaveBeenCalledWith(KEY);
  });

  it.each([
    [Buffer.from('not-pdf'), SHA256, 'INVALID_PDF'],
    [PDF, 'b'.repeat(64), 'CHECKSUM_MISMATCH'],
  ])('records terminal validation error %s', async (buffer, actualHash, errorCode) => {
    deps = makeDeps({
      downloadPdf: vi.fn().mockResolvedValue(buffer),
      computeSha256: vi.fn().mockResolvedValue(actualHash),
    });

    await createInvoiceProcessJob(deps)(KEY, CLAIM_ID);

    expect(deps.transitionToTerminal).toHaveBeenCalledWith(JOB_ID, 'FAILED', {
      errorCode,
    });
    expect(deps.writeInvoice).not.toHaveBeenCalled();
    expect(deps.deletePdf).toHaveBeenCalledWith(KEY);
  });

  it.each([
    [new UnsupportedAwsInvoiceError(), 'UNSUPPORTED_AWS_INVOICE'],
    [new InvoiceTotalMismatchError('INVOICE_AMOUNT'), 'INVOICE_TOTAL_MISMATCH'],
    [new Error('structurally invalid'), 'INVALID_PDF'],
  ])('maps parser failure to sanitized code %s', async (error, errorCode) => {
    deps = makeDeps({ parsePdf: vi.fn().mockRejectedValue(error) });

    await createInvoiceProcessJob(deps)(KEY, CLAIM_ID);

    expect(deps.transitionToTerminal).toHaveBeenCalledWith(JOB_ID, 'FAILED', {
      errorCode,
    });
    expect(deps.deletePdf).toHaveBeenCalledWith(KEY);
  });

  it('writes invoice, metadata, success state, then deletes raw PDF', async () => {
    const calls: string[] = [];
    deps = makeDeps({
      writeInvoice: vi.fn().mockImplementation(async () => calls.push('invoice')),
      writeMetadata: vi.fn().mockImplementation(async () => calls.push('metadata')),
      transitionToTerminal: vi.fn().mockImplementation(async () => calls.push('success')),
      deletePdf: vi.fn().mockImplementation(async () => calls.push('delete')),
    });

    await createInvoiceProcessJob(deps)(KEY, CLAIM_ID);

    expect(calls).toEqual(['invoice', 'metadata', 'success', 'delete']);
    expect(deps.writeInvoice).toHaveBeenCalledWith(
      'users/primary/aws-invoices/2026/2026-07.json',
      invoice,
    );
    expect(deps.writeMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        PK: 'WORKSPACE#primary',
        SK: 'AWS_INVOICE#2026-07',
        yearMonth: '2026-07',
        sha256: SHA256,
      }),
    );
    expect(deps.transitionToTerminal).toHaveBeenCalledWith(JOB_ID, 'SUCCEEDED', {
      yearMonth: '2026-07',
    });
  });

  it('records a month-only conflict without writing destination data', async () => {
    deps = makeDeps({
      getMetadata: vi.fn().mockResolvedValue({
        yearMonth: '2026-07',
        sha256: 'c'.repeat(64),
        uploadedAt: '2026-07-01T00:00:00.000Z',
      }),
    });

    await createInvoiceProcessJob(deps)(KEY, CLAIM_ID);

    expect(deps.transitionToTerminal).toHaveBeenCalledWith(JOB_ID, 'CONFLICT', {
      errorCode: 'INVOICE_CONFLICT',
      conflict: { year: 2026, month: 7 },
    });
    expect(deps.writeInvoice).not.toHaveBeenCalled();
    expect(deps.deletePdf).toHaveBeenCalledWith(KEY);
  });

  it('keeps the raw PDF when a retryable destination write fails', async () => {
    deps = makeDeps({
      writeInvoice: vi.fn().mockRejectedValue(new Error('S3 unavailable')),
    });

    await expect(createInvoiceProcessJob(deps)(KEY, CLAIM_ID)).rejects.toThrow(
      'S3 unavailable',
    );
    expect(deps.deletePdf).not.toHaveBeenCalled();
  });

  it('resumes after an identical destination write without rewriting it', async () => {
    deps = makeDeps({
      claimJob: vi.fn().mockResolvedValue('resume'),
      getDestinationInvoice: vi.fn().mockResolvedValue(invoice),
    });

    await createInvoiceProcessJob(deps)(KEY, CLAIM_ID);

    expect(deps.writeInvoice).not.toHaveBeenCalled();
    expect(deps.writeMetadata).toHaveBeenCalled();
    expect(deps.transitionToTerminal).toHaveBeenCalledWith(JOB_ID, 'SUCCEEDED', {
      yearMonth: '2026-07',
    });
  });
});

describe('invoice parser metrics', () => {
  it('emits only function and sanitized error-code dimensions', () => {
    const writeMetric = vi.fn();

    emitAwsInvoiceParseFailureMetric(
      'INVOICE_TOTAL_MISMATCH',
      'cashight-invoice-parser-worker',
      1_786_000_000_000,
      writeMetric,
    );

    const metric = JSON.parse(writeMetric.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(metric).toMatchObject({
      FunctionName: 'cashight-invoice-parser-worker',
      ErrorCode: 'INVOICE_TOTAL_MISMATCH',
      AwsInvoiceParseFailure: 1,
    });
    expect(Object.keys(metric).sort()).toEqual([
      'AwsInvoiceParseFailure',
      'ErrorCode',
      'FunctionName',
      '_aws',
    ]);
    expect(JSON.stringify(metric)).not.toMatch(
      /account|address|amount|invoiceNumber|rawText/i,
    );
  });
});

function queueRecord(messageId: string, key: string): InvoiceQueueRecord {
  return {
    messageId,
    body: JSON.stringify({ Records: [{ s3: { object: { key } } }] }),
  };
}

describe('invoice parser SQS handler', () => {
  it('returns only retryable records in the partial batch response', async () => {
    const processJob = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('retryable'));
    const handler = createInvoiceParserWorkerHandler(processJob);

    const response = await handler({
      Records: [
        queueRecord('message-1', KEY),
        queueRecord('message-2', KEY),
      ],
    });

    expect(processJob).toHaveBeenNthCalledWith(1, KEY, 'message-1');
    expect(processJob).toHaveBeenNthCalledWith(2, KEY, 'message-2');
    expect(response).toEqual({
      batchItemFailures: [{ itemIdentifier: 'message-2' }],
    });
  });
});
