'use client';

import { useMemo } from 'react';
import { uploadErrorMessage } from '@cashight/domain/upload-error';

import {
  CreateUploadResponseSchema,
  UploadJobResponseSchema,
  type UploadJob,
} from '@/frontend/api/contracts';
import {
  usePdfUploadJob,
  type PdfUploadJobState,
} from '@/frontend/hooks/use-pdf-upload-job';

type StatementConflict = {
  cardLast4: string;
  year: number;
  month: number;
};

export type UploadJobHookState = PdfUploadJobState<StatementConflict>;

const statementUploadOptions = {
  createPath: '/uploads',
  statusPath: '/uploads',
  parseCreate: (value: unknown) => CreateUploadResponseSchema.parse(value),
  parseJob: (value: unknown): UploadJob =>
    UploadJobResponseSchema.parse(value).job,
  mapError: (errorCode: UploadJob['errorCode']) =>
    uploadErrorMessage(errorCode),
  fallbackConflict: (): StatementConflict => ({
    cardLast4: '????',
    year: 0,
    month: 0,
  }),
  labels: {
    hashing: 'Computing checksum…',
    creating: 'Creating upload…',
    uploading: 'Uploading PDF…',
    processing: 'Processing statement…',
    success: 'Statement saved',
  },
};

export function useUploadJob(onSucceeded?: (job: UploadJob) => void): {
  state: UploadJobHookState;
  start: (file: File, force?: boolean) => void;
  reset: () => void;
} {
  const options = useMemo(() => ({ ...statementUploadOptions, onSucceeded }), [onSucceeded]);
  return usePdfUploadJob(options);
}
