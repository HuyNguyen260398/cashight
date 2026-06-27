import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  createUploadStatusApiHandler,
  type UploadStatusApiDependencies,
} from '../functions/upload-status-api/handler';

const mockAuthorizedRecord = {
  PK: 'AUTHZ#user-123' as const,
  SK: 'PROFILE' as const,
  active: true as const,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
};

const mockJobRecord = {
  PK: 'JOB#test-job-id' as const,
  SK: 'METADATA' as const,
  sub: 'user-123',
  state: 'PENDING_UPLOAD' as const,
  sha256: 'a'.repeat(64),
  force: false,
  createdAt: '2026-06-27T12:00:00.000Z',
  updatedAt: '2026-06-27T12:00:00.000Z',
  expiresAtEpoch: 1751068800,
};

function makeDeps(overrides: Partial<UploadStatusApiDependencies> = {}): UploadStatusApiDependencies {
  return {
    getAuthorizedUser: vi.fn().mockResolvedValue(mockAuthorizedRecord),
    getJobRecord: vi.fn().mockResolvedValue(mockJobRecord),
    ...overrides,
  };
}

function makeEvent(jobId: string, claims: Record<string, unknown> = {}): unknown {
  return {
    httpMethod: 'GET',
    path: `/uploads/${jobId}`,
    pathParameters: { jobId },
    headers: {},
    body: null,
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

describe('GET /uploads/{jobId}', () => {
  let deps: UploadStatusApiDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
  });

  it('rejects unauthenticated requests', async () => {
    const handler = createUploadStatusApiHandler(deps);
    const res = await handler(makeEvent('test-job-id', { sub: undefined, token_use: undefined }));
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthorized subjects', async () => {
    const handler = createUploadStatusApiHandler(
      makeDeps({ getAuthorizedUser: vi.fn().mockResolvedValue(undefined) }),
    );
    const res = await handler(makeEvent('test-job-id'));
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown job', async () => {
    const handler = createUploadStatusApiHandler(
      makeDeps({ getJobRecord: vi.fn().mockResolvedValue(undefined) }),
    );
    const res = await handler(makeEvent('unknown-job-id'));
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a job belonging to another user', async () => {
    const handler = createUploadStatusApiHandler(
      makeDeps({
        getJobRecord: vi.fn().mockResolvedValue({ ...mockJobRecord, sub: 'other-user' }),
      }),
    );
    const res = await handler(makeEvent('test-job-id'));
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when jobId path parameter is missing', async () => {
    const handler = createUploadStatusApiHandler(deps);
    const event = {
      httpMethod: 'GET',
      pathParameters: null,
      headers: {},
      body: null,
      requestContext: {
        requestId: 'test-request-id',
        authorizer: {
          claims: { sub: 'user-123', token_use: 'access', scope: 'cashight/read cashight/write' },
        },
      },
    };
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns the job for the authenticated owner', async () => {
    const handler = createUploadStatusApiHandler(deps);
    const res = await handler(makeEvent('test-job-id'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job.state).toBe('PENDING_UPLOAD');
    expect(body.job.jobId).toBe('test-job-id');
  });

  it('returns SUCCEEDED job state correctly', async () => {
    const handler = createUploadStatusApiHandler(
      makeDeps({
        getJobRecord: vi.fn().mockResolvedValue({
          ...mockJobRecord,
          state: 'SUCCEEDED',
          statementId: '2026-05-9674',
        }),
      }),
    );
    const res = await handler(makeEvent('test-job-id'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job.state).toBe('SUCCEEDED');
    expect(body.job.statementId).toBe('2026-05-9674');
  });

  it('returns CONFLICT job state with conflict details', async () => {
    const handler = createUploadStatusApiHandler(
      makeDeps({
        getJobRecord: vi.fn().mockResolvedValue({
          ...mockJobRecord,
          state: 'CONFLICT',
          conflict: { cardLast4: '9674', year: 2026, month: 5 },
        }),
      }),
    );
    const res = await handler(makeEvent('test-job-id'));
    const body = JSON.parse(res.body);
    expect(body.job.state).toBe('CONFLICT');
    expect(body.job.conflict).toEqual({ cardLast4: '9674', year: 2026, month: 5 });
  });
});
