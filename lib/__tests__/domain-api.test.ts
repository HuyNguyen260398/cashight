import { describe, expect, it } from 'vitest';

import {
  CreateUploadRequestSchema,
  UploadJobSchema,
  UploadJobStateSchema,
} from '@cashight/domain/api';

describe('@cashight/domain API schemas', () => {
  it('defaults a valid upload request to non-forced processing', () => {
    expect(
      CreateUploadRequestSchema.parse({
        fileName: 'statement.pdf',
        contentType: 'application/pdf',
        size: 1024,
        sha256: 'a'.repeat(64),
      }),
    ).toEqual({
      fileName: 'statement.pdf',
      contentType: 'application/pdf',
      size: 1024,
      sha256: 'a'.repeat(64),
      force: false,
    });
  });

  it('rejects upload metadata outside the API contract', () => {
    expect(
      CreateUploadRequestSchema.safeParse({
        fileName: 'statement.pdf',
        contentType: 'text/plain',
        size: 5 * 1024 * 1024 + 1,
        sha256: 'INVALID',
      }).success,
    ).toBe(false);
  });

  it('accepts every documented upload job state', () => {
    for (const state of [
      'PENDING_UPLOAD',
      'PROCESSING',
      'CONFLICT',
      'SUCCEEDED',
      'FAILED',
    ]) {
      expect(UploadJobStateSchema.parse(state)).toBe(state);
    }
  });

  it('validates conflict details on upload jobs', () => {
    expect(
      UploadJobSchema.parse({
        jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        state: 'CONFLICT',
        createdAt: '2026-06-27T12:00:00.000Z',
        updatedAt: '2026-06-27T12:01:00.000Z',
        conflict: {
          cardLast4: '9674',
          year: 2026,
          month: 5,
        },
      }),
    ).toMatchObject({
      state: 'CONFLICT',
      conflict: { cardLast4: '9674', year: 2026, month: 5 },
    });
  });
});
