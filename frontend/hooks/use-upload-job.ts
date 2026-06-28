'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/frontend/api/client';
import { getPublicConfig } from '@/frontend/auth/config';
import { computeSha256 } from '@/frontend/lib/sha256';
import { sleep } from '@/frontend/lib/sleep';
import {
  CreateUploadResponseSchema,
  UploadJobResponseSchema,
} from '@/frontend/api/contracts';
import type { UploadJob } from '@/frontend/api/contracts';

// ── Types ─────────────────────────────────────────────────────────────────────

export type UploadJobHookState =
  | { phase: 'idle' }
  | { phase: 'working'; step: 'hashing' | 'creating' | 'uploading' | 'polling'; message: string }
  | { phase: 'conflict'; conflict: { cardLast4: string; year: number; month: number }; file: File }
  | { phase: 'succeeded' }
  | { phase: 'failed'; error: string };

// ── Polling helpers ───────────────────────────────────────────────────────────

/** Delays between poll attempts (ms). After the array is exhausted, 5 s is used. */
const POLL_DELAYS_MS = [1000, 2000, 4000];
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

async function pollUntilTerminal(
  jobId: string,
  apiBaseUrl: string,
  startTime: number,
  isCancelled: () => boolean,
): Promise<UploadJob> {
  let attempt = 0;

  while (true) {
    if (isCancelled()) throw new Error('cancelled');

    const elapsed = Date.now() - startTime;
    if (elapsed > POLL_TIMEOUT_MS) {
      throw new Error('Upload timed out after 2 minutes');
    }

    const delay =
      attempt < POLL_DELAYS_MS.length ? POLL_DELAYS_MS[attempt] : 5000;
    await sleep(delay);
    attempt++;

    if (isCancelled()) throw new Error('cancelled');

    const res = await apiFetch(`${apiBaseUrl}/uploads/${jobId}`);
    const data = UploadJobResponseSchema.parse(await res.json());
    const { job } = data;

    if (job.state === 'PENDING_UPLOAD' || job.state === 'PROCESSING') {
      continue;
    }

    return job;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Manages the full presigned-upload lifecycle:
 *   1. SHA-256 hash the file
 *   2. POST /uploads → presigned URL
 *   3. PUT the file to the presigned URL (plain fetch, not apiFetch)
 *   4. Poll GET /uploads/:jobId until terminal state
 *
 * On CONFLICT the state changes to `{ phase: 'conflict', ... }` so the UI can
 * show a confirmation dialog. Call `start(file, true)` to force-overwrite.
 *
 * Call `reset()` to return to the idle state from any non-working phase.
 */
export function useUploadJob(): {
  state: UploadJobHookState;
  start: (file: File, force?: boolean) => void;
  reset: () => void;
} {
  const [state, setState] = useState<UploadJobHookState>({ phase: 'idle' });
  // Monotonically increasing generation counter; each new `start` call
  // increments it so stale async operations from a previous run are silently
  // discarded.
  const generationRef = useRef(0);

  const start = useCallback((file: File, force = false) => {
    const generation = ++generationRef.current;
    const isCancelled = () => generationRef.current !== generation;

    setState({
      phase: 'working',
      step: 'hashing',
      message: 'Computing checksum…',
    });

    void (async () => {
      try {
        // Step 1: Hash
        const buffer = await file.arrayBuffer();
        if (isCancelled()) return;
        const sha256 = await computeSha256(buffer);
        if (isCancelled()) return;

        // Step 2: Create upload job
        setState({
          phase: 'working',
          step: 'creating',
          message: 'Creating upload…',
        });
        const config = getPublicConfig();
        const createRes = await apiFetch(`${config.apiBaseUrl}/uploads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            contentType: 'application/pdf',
            size: file.size,
            sha256,
            force,
          }),
        });
        const createData = CreateUploadResponseSchema.parse(await createRes.json());
        const { job: initialJob, upload } = createData;
        if (isCancelled()) return;

        // Step 3: PUT to presigned URL — use plain fetch, NOT apiFetch, because
        // the presigned URL has auth baked in (an extra Authorization header
        // would corrupt the AWS signature).
        setState({
          phase: 'working',
          step: 'uploading',
          message: 'Uploading PDF…',
        });
        const putRes = await fetch(upload.url, {
          method: upload.method,
          headers: upload.headers,
          body: buffer,
        });
        if (isCancelled()) return;
        if (!putRes.ok) {
          setState({
            phase: 'failed',
            error: `S3 upload failed (HTTP ${putRes.status})`,
          });
          return;
        }

        // Step 4: Poll
        setState({
          phase: 'working',
          step: 'polling',
          message: 'Processing statement…',
        });
        const startTime = Date.now();
        const finalJob = await pollUntilTerminal(
          initialJob.jobId,
          config.apiBaseUrl,
          startTime,
          isCancelled,
        );
        if (isCancelled()) return;

        switch (finalJob.state) {
          case 'SUCCEEDED':
            toast.success('Statement saved');
            setState({ phase: 'succeeded' });
            break;

          case 'CONFLICT': {
            const conflict = finalJob.conflict ?? {
              cardLast4: '????',
              year: 0,
              month: 0,
            };
            setState({ phase: 'conflict', conflict, file });
            break;
          }

          case 'FAILED':
          default:
            setState({
              phase: 'failed',
              error: finalJob.errorCode ?? 'Processing failed',
            });
        }
      } catch (err: unknown) {
        if (isCancelled()) return;
        if (err instanceof Error && err.message === 'cancelled') return;
        setState({
          phase: 'failed',
          error:
            err instanceof Error ? err.message : 'Network error — please try again.',
        });
      }
    })();
  }, []);

  const reset = useCallback(() => {
    generationRef.current++; // cancel any in-flight operation
    setState({ phase: 'idle' });
  }, []);

  return { state, start, reset };
}
