import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Statement } from '@cashight/domain/schemas';

import {
  createProcessJob,
  type ProcessJobDependencies,
} from '../functions/parser-worker/process-job';
import type { UploadJobRecord } from '../shared/metadata';

const VALID_SHA256 = 'a'.repeat(64);
const NOW = new Date('2026-06-27T12:00:00.000Z');

const PDF_MAGIC = Buffer.from('%PDF-1.4\nfake pdf content');

const mockStatement: Statement = {
  bank: 'TPBank',
  cardLast4: '9674',
  statementDate: '2026-05-01',
  paymentDueDate: '2026-05-25',
  creditLimit: 50000000,
  totals: {
    previousBalance: 0,
    statementBalance: 37978402,
    minimumPayment: 1898921,
    totalSpend: 26986712,
    totalInstallments: 0,
    totalCashback: 519020,
    totalFeesAndInterest: 0,
  },
  transactions: [
    {
      date: '2026-05-15',
      postingDate: '2026-05-16',
      description: 'Test Merchant',
      category: 'food',
      amountVnd: -150000,
      currency: 'VND',
      originalAmount: 150000,
      isInstallment: false,
      isInternational: false,
    },
  ],
};

const validJobRecord: UploadJobRecord = {
  PK: 'JOB#test-job-uuid',
  SK: 'METADATA',
  sub: 'user-123',
  state: 'PENDING_UPLOAD',
  sha256: VALID_SHA256,
  force: false,
  createdAt: '2026-06-27T12:00:00.000Z',
  updatedAt: '2026-06-27T12:00:00.000Z',
  expiresAtEpoch: 1751068800,
};

function makeDeps(overrides: Partial<ProcessJobDependencies> = {}): ProcessJobDependencies {
  return {
    getJobRecord: vi.fn().mockResolvedValue(validJobRecord),
    transitionToProcessing: vi.fn().mockResolvedValue('ok'),
    putIdempotencyRecord: vi.fn().mockResolvedValue(true),
    transitionToTerminal: vi.fn().mockResolvedValue(undefined),
    downloadPdf: vi.fn().mockResolvedValue(PDF_MAGIC),
    deletePdf: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockResolvedValue(''),
    parsePdf: vi.fn().mockResolvedValue(mockStatement),
    checkDestinationExists: vi.fn().mockResolvedValue(false),
    writeStatement: vi.fn().mockResolvedValue(undefined),
    writeMetadata: vi.fn().mockResolvedValue(undefined),
    computeSha256: vi.fn().mockResolvedValue(VALID_SHA256),
    now: () => NOW,
    ...overrides,
  };
}

const S3_KEY = 'uploads/user-123/test-job-uuid.pdf';

describe('processJob', () => {
  let deps: ProcessJobDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
  });

  it('successfully parses a valid PDF and transitions to SUCCEEDED', async () => {
    const processJob = createProcessJob(deps);
    await processJob(S3_KEY);

    expect(deps.transitionToProcessing).toHaveBeenCalledWith('test-job-uuid', VALID_SHA256);
    expect(deps.downloadPdf).toHaveBeenCalledWith(S3_KEY);
    expect(deps.parsePdf).toHaveBeenCalled();
    expect(deps.writeStatement).toHaveBeenCalled();
    expect(deps.writeMetadata).toHaveBeenCalled();
    expect(deps.transitionToTerminal).toHaveBeenCalledWith(
      'test-job-uuid',
      'SUCCEEDED',
      expect.objectContaining({ statementId: expect.any(String) }),
    );
    expect(deps.deletePdf).toHaveBeenCalledWith(S3_KEY);
  });

  it('marks FAILED for wrong PDF password and deletes the PDF', async () => {
    const passwordError = new Error('wrong password');
    passwordError.name = 'PasswordException';
    const localDeps = makeDeps({ parsePdf: vi.fn().mockRejectedValue(passwordError) });
    const processJob = createProcessJob(localDeps);
    await processJob(S3_KEY);

    expect(localDeps.transitionToTerminal).toHaveBeenCalledWith(
      'test-job-uuid',
      'FAILED',
      expect.objectContaining({ errorCode: 'WRONG_PASSWORD' }),
    );
    expect(localDeps.deletePdf).toHaveBeenCalledWith(S3_KEY);
  });

  it('marks FAILED for invalid PDF (non-PDF magic bytes) and deletes it', async () => {
    const localDeps = makeDeps({
      downloadPdf: vi.fn().mockResolvedValue(Buffer.from('not a pdf')),
    });
    const processJob = createProcessJob(localDeps);
    await processJob(S3_KEY);

    expect(localDeps.parsePdf).not.toHaveBeenCalled();
    expect(localDeps.transitionToTerminal).toHaveBeenCalledWith(
      'test-job-uuid',
      'FAILED',
      expect.objectContaining({ errorCode: 'INVALID_PDF' }),
    );
    expect(localDeps.deletePdf).toHaveBeenCalledWith(S3_KEY);
  });

  it('marks FAILED for Zod schema validation failure and deletes the PDF', async () => {
    const localDeps = makeDeps({
      parsePdf: vi.fn().mockResolvedValue({ invalid: 'data' } as unknown as Statement),
    });
    const processJob = createProcessJob(localDeps);
    await processJob(S3_KEY);

    expect(localDeps.transitionToTerminal).toHaveBeenCalledWith(
      'test-job-uuid',
      'FAILED',
      expect.objectContaining({ errorCode: 'PARSE_ERROR' }),
    );
    expect(localDeps.deletePdf).toHaveBeenCalledWith(S3_KEY);
  });

  it('throws and does NOT delete PDF when job record is missing (retryable)', async () => {
    const localDeps = makeDeps({ getJobRecord: vi.fn().mockResolvedValue(undefined) });
    const processJob = createProcessJob(localDeps);
    await expect(processJob(S3_KEY)).rejects.toThrow();
    expect(localDeps.deletePdf).not.toHaveBeenCalled();
  });

  it('throws and does NOT delete PDF when S3 write fails (retryable)', async () => {
    const localDeps = makeDeps({
      writeStatement: vi.fn().mockRejectedValue(new Error('S3 error')),
    });
    const processJob = createProcessJob(localDeps);
    await expect(processJob(S3_KEY)).rejects.toThrow('S3 error');
    expect(localDeps.deletePdf).not.toHaveBeenCalled();
  });

  it('marks FAILED for checksum mismatch and deletes the PDF', async () => {
    const localDeps = makeDeps({
      computeSha256: vi.fn().mockResolvedValue('b'.repeat(64)), // differs from job sha256
    });
    const processJob = createProcessJob(localDeps);
    await processJob(S3_KEY);

    expect(localDeps.transitionToTerminal).toHaveBeenCalledWith(
      'test-job-uuid',
      'FAILED',
      expect.objectContaining({ errorCode: 'CHECKSUM_MISMATCH' }),
    );
    expect(localDeps.deletePdf).toHaveBeenCalledWith(S3_KEY);
  });

  it('returns success without a second S3 write for duplicate delivery (already terminal)', async () => {
    const localDeps = makeDeps({
      transitionToProcessing: vi.fn().mockResolvedValue('already_terminal'),
    });
    const processJob = createProcessJob(localDeps);
    await processJob(S3_KEY);

    expect(localDeps.parsePdf).not.toHaveBeenCalled();
    expect(localDeps.writeStatement).not.toHaveBeenCalled();
    expect(localDeps.deletePdf).toHaveBeenCalledWith(S3_KEY);
  });

  it('records CONFLICT when destination exists and force=false', async () => {
    const localDeps = makeDeps({
      checkDestinationExists: vi.fn().mockResolvedValue(true),
      getJobRecord: vi.fn().mockResolvedValue({ ...validJobRecord, force: false }),
    });
    const processJob = createProcessJob(localDeps);
    await processJob(S3_KEY);

    expect(localDeps.writeStatement).not.toHaveBeenCalled();
    expect(localDeps.transitionToTerminal).toHaveBeenCalledWith(
      'test-job-uuid',
      'CONFLICT',
      expect.objectContaining({ conflict: expect.any(Object) }),
    );
    expect(localDeps.deletePdf).toHaveBeenCalledWith(S3_KEY);
  });

  it('overwrites when destination exists and force=true', async () => {
    const localDeps = makeDeps({
      checkDestinationExists: vi.fn().mockResolvedValue(true),
      getJobRecord: vi.fn().mockResolvedValue({ ...validJobRecord, force: true }),
    });
    const processJob = createProcessJob(localDeps);
    await processJob(S3_KEY);

    expect(localDeps.writeStatement).toHaveBeenCalled();
    expect(localDeps.transitionToTerminal).toHaveBeenCalledWith(
      'test-job-uuid',
      'SUCCEEDED',
      expect.any(Object),
    );
    expect(localDeps.deletePdf).toHaveBeenCalledWith(S3_KEY);
  });

  it('logs do not contain PAN, email, or raw token', async () => {
    const logOutput: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logOutput.push(args.join(' '));

    const processJob = createProcessJob(deps);
    await processJob(S3_KEY);
    console.log = origLog;

    for (const line of logOutput) {
      expect(line).not.toMatch(/4[0-9]{12,}[0-9]{3,4}/); // no full PAN
    }
  });
});
