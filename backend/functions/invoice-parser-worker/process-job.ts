import { createHash } from 'node:crypto';

import {
  AwsInvoiceSchema,
  YearMonthSchema,
  type AwsInvoice,
  type YearMonth,
} from '@cashight/domain/aws-invoices';
import {
  InvoiceTotalMismatchError,
  UnsupportedAwsInvoiceError,
} from '@cashight/domain/parsers/aws-invoice';
import { z } from 'zod';

import type {
  AwsInvoiceJobClaimResult,
  AwsInvoiceMetadataRecord,
  AwsInvoiceUploadJobRecord,
} from '../../shared/metadata';
import { awsInvoiceObjectKey } from '../../shared/storage';

type ExistingMetadata = Pick<
  AwsInvoiceMetadataRecord,
  'yearMonth' | 'sha256' | 'parserId' | 'parserVersion' | 'uploadedAt'
>;

export interface InvoiceProcessJobDependencies {
  getJobRecord: (
    jobId: string,
  ) => Promise<AwsInvoiceUploadJobRecord | undefined>;
  claimJob: (
    jobId: string,
    claimId: string,
  ) => Promise<AwsInvoiceJobClaimResult>;
  transitionToTerminal: (
    jobId: string,
    state: 'SUCCEEDED' | 'CONFLICT' | 'FAILED',
    extra?: {
      errorCode?:
        | 'UNSUPPORTED_AWS_INVOICE'
        | 'INVOICE_TOTAL_MISMATCH'
        | 'INVOICE_CONFLICT'
        | 'INVALID_PDF'
        | 'CHECKSUM_MISMATCH';
      yearMonth?: YearMonth;
      conflict?: { year: number; month: number };
    },
  ) => Promise<void>;
  downloadPdf: (key: string) => Promise<Buffer>;
  deletePdf: (key: string) => Promise<void>;
  computeSha256: (buffer: Buffer) => Promise<string>;
  parsePdf: (
    buffer: Buffer,
    source: { sha256: string; uploadedAt: string },
  ) => Promise<AwsInvoice>;
  getMetadata: (
    workspaceId: 'primary',
    yearMonth: string,
  ) => Promise<ExistingMetadata | undefined>;
  getDestinationInvoice: (key: string) => Promise<AwsInvoice | undefined>;
  writeInvoice: (key: string, invoice: AwsInvoice) => Promise<void>;
  writeMetadata: (record: AwsInvoiceMetadataRecord) => Promise<void>;
}

function parseUploadKey(key: string): { workspaceId: 'primary'; jobId: string } {
  const match = /^uploads\/aws-invoices\/primary\/([0-9a-f-]{36})\.pdf$/i.exec(
    key,
  );
  if (!match) throw new Error('Unexpected AWS invoice upload key.');
  return {
    workspaceId: 'primary',
    jobId: z.string().uuid().parse(match[1]),
  };
}

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
}

function isSameAttempt(
  source: AwsInvoice['source'] | ExistingMetadata,
  job: AwsInvoiceUploadJobRecord,
): boolean {
  return (
    source.sha256 === job.sha256 &&
    source.parserId === 'aws-inc-consolidated-usd' &&
    source.parserVersion === 1 &&
    source.uploadedAt === job.createdAt
  );
}

function errorCode(error: unknown):
  | 'UNSUPPORTED_AWS_INVOICE'
  | 'INVOICE_TOTAL_MISMATCH'
  | 'INVALID_PDF' {
  if (error instanceof UnsupportedAwsInvoiceError) {
    return 'UNSUPPORTED_AWS_INVOICE';
  }
  if (error instanceof InvoiceTotalMismatchError) {
    return 'INVOICE_TOTAL_MISMATCH';
  }
  return 'INVALID_PDF';
}

async function terminalFailure(
  deps: InvoiceProcessJobDependencies,
  jobId: string,
  key: string,
  code:
    | 'UNSUPPORTED_AWS_INVOICE'
    | 'INVOICE_TOTAL_MISMATCH'
    | 'INVALID_PDF'
    | 'CHECKSUM_MISMATCH',
): Promise<void> {
  await deps.transitionToTerminal(jobId, 'FAILED', { errorCode: code });
  await deps.deletePdf(key);
}

export function createInvoiceProcessJob(deps: InvoiceProcessJobDependencies) {
  return async (s3Key: string, claimId: string): Promise<void> => {
    const { workspaceId, jobId } = parseUploadKey(s3Key);
    z.string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
      .parse(claimId);
    const job = await deps.getJobRecord(jobId);
    if (!job) throw new Error('AWS invoice upload job not found.');
    if (
      job.documentType !== 'AWS_INVOICE' ||
      job.owner.workspaceId !== workspaceId
    ) {
      throw new Error('AWS invoice upload job ownership mismatch.');
    }

    const claim = await deps.claimJob(jobId, claimId);
    if (claim === 'already_terminal') {
      await deps.deletePdf(s3Key);
      return;
    }
    if (claim === 'duplicate') return;
    if (claim === 'not_found') {
      throw new Error('AWS invoice upload job disappeared.');
    }

    const pdf = await deps.downloadPdf(s3Key);
    if (!isPdf(pdf)) {
      await terminalFailure(deps, jobId, s3Key, 'INVALID_PDF');
      return;
    }
    const actualSha256 = await deps.computeSha256(pdf);
    if (actualSha256 !== job.sha256) {
      await terminalFailure(deps, jobId, s3Key, 'CHECKSUM_MISMATCH');
      return;
    }

    let parsedInvoice: AwsInvoice;
    try {
      parsedInvoice = AwsInvoiceSchema.parse(
        await deps.parsePdf(pdf, {
          sha256: actualSha256,
          uploadedAt: job.createdAt,
        }),
      );
    } catch (error) {
      await terminalFailure(deps, jobId, s3Key, errorCode(error));
      return;
    }

    const yearMonth = YearMonthSchema.parse(
      parsedInvoice.billingPeriod.start.slice(0, 7),
    );
    const [year, month] = yearMonth.split('-').map(Number);
    const objectKey = awsInvoiceObjectKey(workspaceId, year, month);
    const existingMetadata = await deps.getMetadata(workspaceId, yearMonth);
    if (existingMetadata && isSameAttempt(existingMetadata, job)) {
      await deps.transitionToTerminal(jobId, 'SUCCEEDED', { yearMonth });
      await deps.deletePdf(s3Key);
      return;
    }
    if (existingMetadata && !job.force) {
      await deps.transitionToTerminal(jobId, 'CONFLICT', {
        errorCode: 'INVOICE_CONFLICT',
        conflict: { year, month },
      });
      await deps.deletePdf(s3Key);
      return;
    }

    const existingDestination = await deps.getDestinationInvoice(objectKey);
    const destinationIsThisAttempt =
      existingDestination !== undefined &&
      isSameAttempt(existingDestination.source, job);
    if (existingDestination && !destinationIsThisAttempt && !job.force) {
      await deps.transitionToTerminal(jobId, 'CONFLICT', {
        errorCode: 'INVOICE_CONFLICT',
        conflict: { year, month },
      });
      await deps.deletePdf(s3Key);
      return;
    }
    if (!destinationIsThisAttempt) {
      await deps.writeInvoice(objectKey, parsedInvoice);
    }

    await deps.writeMetadata({
      PK: 'WORKSPACE#primary',
      SK: `AWS_INVOICE#${yearMonth}`,
      yearMonth,
      objectKey,
      currency: parsedInvoice.currency,
      amountDue: parsedInvoice.totals.amountDue,
      tax: parsedInvoice.totals.tax,
      serviceCount: parsedInvoice.services.length,
      linkedAccountCount: parsedInvoice.linkedAccounts.length,
      sha256: actualSha256,
      parserId: parsedInvoice.source.parserId,
      parserVersion: parsedInvoice.source.parserVersion,
      uploadedAt: parsedInvoice.source.uploadedAt,
    });
    await deps.transitionToTerminal(jobId, 'SUCCEEDED', { yearMonth });
    await deps.deletePdf(s3Key);
  };
}

export function computeSha256(buffer: Buffer): Promise<string> {
  return Promise.resolve(createHash('sha256').update(buffer).digest('hex'));
}
