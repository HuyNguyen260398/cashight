import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  createUploadsApiHandler,
  type UploadsApiDependencies,
} from '../functions/uploads-api/handler';

const VALID_SHA256 = 'a'.repeat(64);
const NOW = new Date('2026-06-27T12:00:00.000Z');
const SEVEN_DAYS_EPOCH =
  Math.floor(NOW.getTime() / 1000) + 7 * 24 * 60 * 60;

const mockAuthorizedRecord = {
  PK: 'AUTHZ#user-123' as const,
  SK: 'PROFILE' as const,
  active: true as const,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
};

function makeDeps(overrides: Partial<UploadsApiDependencies> = {}): UploadsApiDependencies {
  return {
    getAuthorizedUser: vi.fn().mockResolvedValue(mockAuthorizedRecord),
    putJobRecord: vi.fn().mockResolvedValue(undefined),
    presign: vi.fn().mockResolvedValue({
      url: 'https://s3.example.com/presigned',
      headers: {
        'Content-Type': 'application/pdf',
        'x-amz-checksum-sha256': Buffer.from(VALID_SHA256, 'hex').toString('base64'),
      },
      expiresAt: '2026-06-27T12:05:00.000Z',
    }),
    now: () => NOW,
    ...overrides,
  };
}

function makeEvent(body: unknown, claims: Record<string, unknown> = {}): unknown {
  return {
    httpMethod: 'POST',
    path: '/uploads',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    requestContext: {
      requestId: 'test-request-id',
      authorizer: {
        claims: {
          sub: 'user-123',
          token_use: 'access',
          scope: 'cashight/read cashight/write',
          ...claims,
        },
      },
    },
  };
}

const validBody = {
  fileName: 'statement.pdf',
  contentType: 'application/pdf',
  size: 1024 * 1024,
  sha256: VALID_SHA256,
  force: false,
};

describe('POST /uploads', () => {
  let deps: UploadsApiDependencies;

  beforeEach(() => {
    deps = makeDeps();
    vi.clearAllMocks();
    deps = makeDeps();
  });

  it('rejects invalid content type', async () => {
    const handler = createUploadsApiHandler(deps);
    const res = await handler(makeEvent({ ...validBody, contentType: 'application/octet-stream' }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects size exceeding 5 MiB', async () => {
    const handler = createUploadsApiHandler(deps);
    const res = await handler(makeEvent({ ...validBody, size: 5 * 1024 * 1024 + 1 }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid SHA-256 (wrong length)', async () => {
    const handler = createUploadsApiHandler(deps);
    const res = await handler(makeEvent({ ...validBody, sha256: 'abc123' }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid SHA-256 (non-hex characters)', async () => {
    const handler = createUploadsApiHandler(deps);
    const res = await handler(makeEvent({ ...validBody, sha256: 'g'.repeat(64) }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const handler = createUploadsApiHandler(deps);
    const res = await handler(makeEvent(validBody, { sub: undefined, token_use: undefined }));
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests without write scope', async () => {
    const handler = createUploadsApiHandler(deps);
    const res = await handler(makeEvent(validBody, { scope: 'cashight/read' }));
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthorized subjects (no authorization record)', async () => {
    const handler = createUploadsApiHandler(
      makeDeps({ getAuthorizedUser: vi.fn().mockResolvedValue(undefined) }),
    );
    const res = await handler(makeEvent(validBody));
    expect(res.statusCode).toBe(403);
  });

  it('creates a PENDING_UPLOAD job with 7-day TTL on success', async () => {
    const handler = createUploadsApiHandler(deps);
    const res = await handler(makeEvent(validBody));
    expect(res.statusCode).toBe(200);

    const putCall = vi.mocked(deps.putJobRecord).mock.calls[0][0];
    expect(putCall.state).toBe('PENDING_UPLOAD');
    expect(putCall.sub).toBe('user-123');
    expect(putCall.sha256).toBe(VALID_SHA256);
    expect(putCall.force).toBe(false);
    expect(putCall.expiresAtEpoch).toBe(SEVEN_DAYS_EPOCH);
  });

  it('returns job and presigned upload details without exposing S3 key', async () => {
    const handler = createUploadsApiHandler(deps);
    const res = await handler(makeEvent(validBody));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('job');
    expect(body).toHaveProperty('upload');
    expect(body.job.state).toBe('PENDING_UPLOAD');
    expect(body.job.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.upload.method).toBe('PUT');
    expect(body.upload.url).toBeDefined();
    expect(body.upload.headers).toBeDefined();
    expect(body.upload.expiresAt).toBeDefined();
    // S3 key must not appear in the response
    expect(JSON.stringify(body)).not.toContain('uploads/');
  });

  it('passes force flag to the job record', async () => {
    const handler = createUploadsApiHandler(deps);
    await handler(makeEvent({ ...validBody, force: true }));
    const putCall = vi.mocked(deps.putJobRecord).mock.calls[0][0];
    expect(putCall.force).toBe(true);
  });

  it('returns 500 when presign fails', async () => {
    const handler = createUploadsApiHandler(
      makeDeps({ presign: vi.fn().mockRejectedValue(new Error('presign error')) }),
    );
    const res = await handler(makeEvent(validBody));
    expect(res.statusCode).toBe(500);
  });
});
