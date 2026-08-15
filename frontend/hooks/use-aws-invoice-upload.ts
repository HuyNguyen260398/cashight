'use client';

import type {
  AwsInvoiceErrorCode,
  AwsInvoiceUploadJob,
} from '@cashight/domain/aws-invoices';

import {
  AwsInvoiceUploadJobResponseSchema,
  CreateAwsInvoiceUploadResponseSchema,
} from '@/frontend/api/contracts';
import {
  usePdfUploadJob,
  type PdfUploadJobState,
} from '@/frontend/hooks/use-pdf-upload-job';

export const AWS_INVOICES_CHANGED_EVENT = 'cashight:aws-invoices-changed';

export type AwsInvoiceConflict = { year: number; month: number };
export type AwsInvoiceUploadState = PdfUploadJobState<AwsInvoiceConflict>;

const ERROR_MESSAGES: Record<AwsInvoiceErrorCode, string> = {
  UNSUPPORTED_AWS_INVOICE:
    'This PDF is not the supported AWS consolidated USD invoice layout.',
  INVOICE_TOTAL_MISMATCH:
    'The invoice totals did not reconcile. The PDF was not saved.',
  INVOICE_CONFLICT:
    'An invoice already exists for this billing month.',
  INVALID_PDF: 'The selected file is not a valid AWS invoice PDF.',
  CHECKSUM_MISMATCH:
    'The uploaded file checksum did not match. Please upload it again.',
};

export function awsInvoiceUploadErrorMessage(errorCode?: string): string {
  if (errorCode && errorCode in ERROR_MESSAGES) {
    return ERROR_MESSAGES[errorCode as AwsInvoiceErrorCode];
  }
  return 'The invoice could not be processed. Please try again.';
}

const invoiceUploadOptions = {
  createPath: '/aws/invoices/uploads',
  statusPath: '/aws/invoices/uploads',
  parseCreate: (value: unknown) =>
    CreateAwsInvoiceUploadResponseSchema.parse(value),
  parseJob: (value: unknown): AwsInvoiceUploadJob =>
    AwsInvoiceUploadJobResponseSchema.parse(value).job,
  mapError: awsInvoiceUploadErrorMessage,
  fallbackConflict: (): AwsInvoiceConflict => ({ year: 0, month: 0 }),
  labels: {
    hashing: 'Computing checksum…',
    creating: 'Creating invoice upload…',
    uploading: 'Uploading PDF…',
    processing: 'Processing invoice…',
    success: 'Invoice saved',
  },
  onSucceeded: (job: AwsInvoiceUploadJob) => {
    window.dispatchEvent(
      new CustomEvent(AWS_INVOICES_CHANGED_EVENT, {
        detail: job.yearMonth ? { yearMonth: job.yearMonth } : {},
      }),
    );
  },
};

export function useAwsInvoiceUpload(): {
  state: AwsInvoiceUploadState;
  start: (file: File, force?: boolean) => void;
  reset: () => void;
} {
  return usePdfUploadJob(invoiceUploadOptions);
}
