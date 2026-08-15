'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { apiFetch } from '@/frontend/api/client';
import type { UploadPresign } from '@/frontend/api/contracts';
import { getPublicConfig } from '@/frontend/auth/config';
import { computeSha256 } from '@/frontend/lib/sha256';
import { sleep } from '@/frontend/lib/sleep';

export interface PdfUploadTerminalJob<TConflict> {
  jobId: string;
  state: 'PENDING_UPLOAD' | 'PROCESSING' | 'CONFLICT' | 'SUCCEEDED' | 'FAILED';
  errorCode?: string;
  conflict?: TConflict;
}

export type PdfUploadJobState<TConflict> =
  | { phase: 'idle' }
  | {
      phase: 'working';
      step: 'hashing' | 'creating' | 'uploading' | 'polling';
      message: string;
    }
  | { phase: 'conflict'; conflict: TConflict; file: File }
  | { phase: 'succeeded' }
  | { phase: 'failed'; error: string };

interface PdfUploadLabels {
  hashing: string;
  creating: string;
  uploading: string;
  processing: string;
  success: string;
}

export interface UsePdfUploadJobOptions<
  TJob extends PdfUploadTerminalJob<TConflict>,
  TConflict,
> {
  createPath: string;
  statusPath: string;
  parseCreate: (value: unknown) => { job: TJob; upload: UploadPresign };
  parseJob: (value: unknown) => TJob;
  mapError: (errorCode: TJob['errorCode']) => string;
  fallbackConflict: () => TConflict;
  labels: PdfUploadLabels;
  onSucceeded?: (job: TJob) => void;
}

const POLL_DELAYS_MS = [1000, 2000, 4000];
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export function usePdfUploadJob<
  TJob extends PdfUploadTerminalJob<TConflict>,
  TConflict,
>(options: UsePdfUploadJobOptions<TJob, TConflict>): {
  state: PdfUploadJobState<TConflict>;
  start: (file: File, force?: boolean) => void;
  reset: () => void;
} {
  const [state, setState] = useState<PdfUploadJobState<TConflict>>({
    phase: 'idle',
  });
  const generationRef = useRef(0);

  const start = useCallback((file: File, force = false) => {
    const generation = ++generationRef.current;
    const isCancelled = () => generationRef.current !== generation;
    const current = options;

    setState({
      phase: 'working',
      step: 'hashing',
      message: current.labels.hashing,
    });

    void (async () => {
      try {
        const buffer = await file.arrayBuffer();
        if (isCancelled()) return;
        const sha256 = await computeSha256(buffer);
        if (isCancelled()) return;

        setState({
          phase: 'working',
          step: 'creating',
          message: current.labels.creating,
        });
        const { apiBaseUrl } = getPublicConfig();
        const createResponse = await apiFetch(
          `${apiBaseUrl}${current.createPath}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              contentType: 'application/pdf',
              size: file.size,
              sha256,
              force,
            }),
          },
        );
        const { job: initialJob, upload } = current.parseCreate(
          await createResponse.json(),
        );
        if (isCancelled()) return;

        setState({
          phase: 'working',
          step: 'uploading',
          message: current.labels.uploading,
        });
        const putResponse = await fetch(upload.url, {
          method: upload.method,
          headers: upload.headers,
          body: buffer,
        });
        if (isCancelled()) return;
        if (!putResponse.ok) {
          setState({
            phase: 'failed',
            error: `S3 upload failed (HTTP ${putResponse.status})`,
          });
          return;
        }

        setState({
          phase: 'working',
          step: 'polling',
          message: current.labels.processing,
        });
        const startTime = Date.now();
        let attempt = 0;
        let finalJob: TJob;
        while (true) {
          if (isCancelled()) throw new Error('cancelled');
          if (Date.now() - startTime > POLL_TIMEOUT_MS) {
            throw new Error('Upload timed out after 2 minutes');
          }
          await sleep(
            attempt < POLL_DELAYS_MS.length
              ? POLL_DELAYS_MS[attempt]
              : 5000,
          );
          attempt += 1;
          if (isCancelled()) throw new Error('cancelled');

          const response = await apiFetch(
            `${apiBaseUrl}${current.statusPath}/${initialJob.jobId}`,
          );
          finalJob = current.parseJob(await response.json());
          if (
            finalJob.state !== 'PENDING_UPLOAD' &&
            finalJob.state !== 'PROCESSING'
          ) {
            break;
          }
        }
        if (isCancelled()) return;

        if (finalJob.state === 'SUCCEEDED') {
          toast.success(current.labels.success);
          current.onSucceeded?.(finalJob);
          setState({ phase: 'succeeded' });
          return;
        }
        if (finalJob.state === 'CONFLICT') {
          setState({
            phase: 'conflict',
            conflict: finalJob.conflict ?? current.fallbackConflict(),
            file,
          });
          return;
        }
        setState({
          phase: 'failed',
          error: current.mapError(finalJob.errorCode),
        });
      } catch (error: unknown) {
        if (isCancelled()) return;
        if (error instanceof Error && error.message === 'cancelled') return;
        setState({
          phase: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Network error — please try again.',
        });
      }
    })();
  }, [options]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    setState({ phase: 'idle' });
  }, []);

  return { state, start, reset };
}
