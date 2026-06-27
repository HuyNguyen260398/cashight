import crypto from 'crypto';

import { StatementSchema } from '@cashight/domain/schemas';
import type { Statement } from '@cashight/domain/schemas';

import type { TransitionResult, UploadJobRecord } from '../../shared/metadata';
import { statementId, statementObjectKey } from '../../shared/storage';

export interface ProcessJobDependencies {
  getJobRecord: (jobId: string) => Promise<UploadJobRecord | undefined>;
  transitionToProcessing: (jobId: string, sha256: string) => Promise<TransitionResult>;
  putIdempotencyRecord: (jobId: string, sha256: string) => Promise<boolean>;
  transitionToTerminal: (
    jobId: string,
    state: 'SUCCEEDED' | 'CONFLICT' | 'FAILED',
    extra?: {
      errorCode?: string;
      statementId?: string;
      conflict?: { cardLast4: string; year: number; month: number };
    },
  ) => Promise<void>;
  downloadPdf: (key: string) => Promise<Buffer>;
  deletePdf: (key: string) => Promise<void>;
  getSecret: (id: string) => Promise<string>;
  parsePdf: (buffer: Buffer, password?: string) => Promise<Statement>;
  checkDestinationExists: (key: string) => Promise<boolean>;
  writeStatement: (key: string, statement: Statement) => Promise<void>;
  writeMetadata: (params: {
    sub: string;
    jobId: string;
    statement: Statement;
    objectKey: string;
    sha256: string;
    uploadedAt: string;
  }) => Promise<void>;
  computeSha256: (buffer: Buffer) => Promise<string>;
  now: () => Date;
}

function isPasswordError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'PasswordException' ||
    err.message.toLowerCase().includes('password') ||
    err.message.toLowerCase().includes('encrypted')
  );
}

function isPdfMagic(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.slice(0, 4).toString('ascii') === '%PDF';
}

function parseKeyParts(key: string): { sub: string; jobId: string } {
  // key format: uploads/{sub}/{jobId}.pdf
  const parts = key.split('/');
  if (parts.length !== 3 || parts[0] !== 'uploads' || !parts[2].endsWith('.pdf')) {
    throw new Error(`Unexpected S3 key format: ${key}`);
  }
  return { sub: parts[1], jobId: parts[2].replace('.pdf', '') };
}

export function createProcessJob(deps: ProcessJobDependencies) {
  return async (s3Key: string): Promise<void> => {
    const { sub, jobId } = parseKeyParts(s3Key);

    const job = await deps.getJobRecord(jobId);
    if (!job) {
      throw new Error(`Upload job not found: ${jobId}`);
    }

    const now = deps.now();
    const updatedAt = now.toISOString();

    // Check for duplicate delivery — if job is already terminal, skip processing
    const transition = await deps.transitionToProcessing(jobId, job.sha256);
    if (transition === 'already_terminal') {
      // Duplicate delivery of completed job — clean up PDF and exit
      await deps.deletePdf(s3Key);
      return;
    }
    if (transition === 'not_found') {
      throw new Error(`Upload job not found after transition: ${jobId}`);
    }

    // Try to create idempotency record; if it exists, another worker already handled this
    const isNew = await deps.putIdempotencyRecord(jobId, job.sha256);
    if (!isNew) {
      // Another worker claimed this job — exit without processing
      return;
    }

    // Download PDF
    const pdfBuffer = await deps.downloadPdf(s3Key);

    // Validate magic bytes
    if (!isPdfMagic(pdfBuffer)) {
      await deps.transitionToTerminal(jobId, 'FAILED', { errorCode: 'INVALID_PDF' });
      await deps.deletePdf(s3Key);
      return;
    }

    // Verify checksum matches the job record
    const actualSha256 = await deps.computeSha256(pdfBuffer);
    if (actualSha256 !== job.sha256) {
      await deps.transitionToTerminal(jobId, 'FAILED', { errorCode: 'CHECKSUM_MISMATCH' });
      await deps.deletePdf(s3Key);
      return;
    }

    // Parse PDF
    let statement: Statement;
    try {
      const pdfPassword = await deps.getSecret(process.env.PDF_PASSWORD_SECRET_ID ?? '');
      const rawStatement = await deps.parsePdf(pdfBuffer, pdfPassword || undefined);
      // Validate with Zod
      statement = StatementSchema.parse(rawStatement);
    } catch (err) {
      if (isPasswordError(err)) {
        await deps.transitionToTerminal(jobId, 'FAILED', { errorCode: 'WRONG_PASSWORD' });
        await deps.deletePdf(s3Key);
        return;
      }
      // Schema or other parse failure
      await deps.transitionToTerminal(jobId, 'FAILED', { errorCode: 'PARSE_ERROR' });
      await deps.deletePdf(s3Key);
      return;
    }

    // Derive destination key
    const [year, month] = statement.statementDate.split('-').map(Number);
    const destKey = statementObjectKey(sub, statement.cardLast4, year, month);
    const stmtId = statementId(statement.cardLast4, year, month);

    // Check for conflict
    const exists = await deps.checkDestinationExists(destKey);
    if (exists && !job.force) {
      await deps.transitionToTerminal(jobId, 'CONFLICT', {
        conflict: { cardLast4: statement.cardLast4, year, month },
      });
      await deps.deletePdf(s3Key);
      return;
    }

    // Write statement to S3 — retryable, do NOT delete PDF on failure
    await deps.writeStatement(destKey, statement);

    // Write metadata to DynamoDB — retryable, do NOT delete PDF on failure
    await deps.writeMetadata({
      sub,
      jobId,
      statement,
      objectKey: destKey,
      sha256: actualSha256,
      uploadedAt: updatedAt,
    });

    // Mark succeeded
    await deps.transitionToTerminal(jobId, 'SUCCEEDED', { statementId: stmtId });
    await deps.deletePdf(s3Key);
  };
}

export function computeSha256(buffer: Buffer): Promise<string> {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return Promise.resolve(hash);
}
