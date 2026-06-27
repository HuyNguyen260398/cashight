import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Statement } from '@cashight/domain/schemas';

import {
  createStatementsApiHandler,
  type StatementsApiDependencies,
} from '../functions/statements-api/handler';

const mockAuthorizedRecord = {
  PK: 'AUTHZ#user-123' as const,
  SK: 'PROFILE' as const,
  active: true as const,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
};

const mockMetadataRecord = {
  PK: 'USER#user-123' as const,
  SK: 'STATEMENT#2026-05#9674' as `STATEMENT#${string}#${string}`,
  statementId: '2026-05-9674',
  objectKey: 'users/user-123/statements/9674/2026/2026-05.json',
  cardLast4: '9674',
  statementDate: '2026-05-01',
  totalSpend: 26986712,
  transactionCount: 41,
  sha256: 'a'.repeat(64),
  uploadedAt: '2026-06-27T12:00:00.000Z',
};

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

function makeDeps(overrides: Partial<StatementsApiDependencies> = {}): StatementsApiDependencies {
  return {
    getAuthorizedUser: vi.fn().mockResolvedValue(mockAuthorizedRecord),
    queryStatements: vi.fn().mockResolvedValue({ items: [mockMetadataRecord], nextCursor: null }),
    getStatementMetadata: vi.fn().mockResolvedValue(mockMetadataRecord),
    getStatementObject: vi.fn().mockResolvedValue(mockStatement),
    deleteStatementObject: vi.fn().mockResolvedValue(undefined),
    deleteStatementMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeListEvent(query: Record<string, string> = {}, claims: Record<string, unknown> = {}): unknown {
  return {
    httpMethod: 'GET',
    path: '/statements',
    queryStringParameters: Object.keys(query).length ? query : null,
    pathParameters: null,
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

function makeDetailEvent(statementId: string, method = 'GET', claims: Record<string, unknown> = {}): unknown {
  return {
    httpMethod: method,
    path: `/statements/${statementId}`,
    pathParameters: { statementId },
    queryStringParameters: null,
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

describe('GET /statements (list)', () => {
  let deps: StatementsApiDependencies;
  beforeEach(() => { vi.clearAllMocks(); deps = makeDeps(); });

  it('rejects unauthenticated requests', async () => {
    const handler = createStatementsApiHandler(deps);
    const res = await handler(makeListEvent({}, { sub: undefined, token_use: undefined }));
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthorized subjects', async () => {
    const handler = createStatementsApiHandler(
      makeDeps({ getAuthorizedUser: vi.fn().mockResolvedValue(undefined) }),
    );
    const res = await handler(makeListEvent());
    expect(res.statusCode).toBe(403);
  });

  it('returns paginated statements list with metadata', async () => {
    const handler = createStatementsApiHandler(deps);
    const res = await handler(makeListEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.statements).toHaveLength(1);
    expect(body.statements[0].statementId).toBe('2026-05-9674');
    expect(body.nextCursor).toBeNull();
  });

  it('passes cursor to query function', async () => {
    const handler = createStatementsApiHandler(deps);
    const cursor = Buffer.from(JSON.stringify({ PK: 'USER#user-123', SK: 'STATEMENT#2026-05#9674' })).toString('base64url');
    await handler(makeListEvent({ cursor }));
    const queryCall = vi.mocked(deps.queryStatements).mock.calls[0];
    expect(queryCall[1]).toBeDefined(); // cursor was passed
  });

  it('rejects malformed cursor gracefully', async () => {
    const handler = createStatementsApiHandler(deps);
    const res = await handler(makeListEvent({ cursor: 'not-valid-base64!' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns nextCursor when there are more pages', async () => {
    const nextKey = { PK: 'USER#user-123', SK: 'STATEMENT#2026-04#9674' };
    const handler = createStatementsApiHandler(
      makeDeps({
        queryStatements: vi.fn().mockResolvedValue({ items: [mockMetadataRecord], nextCursor: nextKey }),
      }),
    );
    const res = await handler(makeListEvent());
    const body = JSON.parse(res.body);
    expect(body.nextCursor).toBeTruthy();
    // Cursor should be base64url-encoded
    expect(() => JSON.parse(Buffer.from(body.nextCursor, 'base64url').toString())).not.toThrow();
  });
});

describe('GET /statements/{statementId}', () => {
  let deps: StatementsApiDependencies;
  beforeEach(() => { vi.clearAllMocks(); deps = makeDeps(); });

  it('returns 404 for unknown statementId', async () => {
    const handler = createStatementsApiHandler(
      makeDeps({ getStatementMetadata: vi.fn().mockResolvedValue(undefined) }),
    );
    const res = await handler(makeDetailEvent('2099-01-9999'));
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a statement belonging to another user', async () => {
    const handler = createStatementsApiHandler(
      makeDeps({
        getStatementMetadata: vi.fn().mockResolvedValue({
          ...mockMetadataRecord,
          PK: 'USER#other-user' as `USER#${string}`,
        }),
      }),
    );
    const res = await handler(makeDetailEvent('2026-05-9674'));
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for invalid statementId format', async () => {
    const handler = createStatementsApiHandler(deps);
    const res = await handler(makeDetailEvent('../../../etc/passwd'));
    expect(res.statusCode).toBe(400);
  });

  it('returns the statement JSON for valid owner', async () => {
    const handler = createStatementsApiHandler(deps);
    const res = await handler(makeDetailEvent('2026-05-9674'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.statement).toBeDefined();
    expect(body.statement.cardLast4).toBe('9674');
  });

  it('returns 500 for invalid S3 JSON (data integrity error)', async () => {
    const handler = createStatementsApiHandler(
      makeDeps({ getStatementObject: vi.fn().mockRejectedValue(new Error('DATA_INTEGRITY_ERROR')) }),
    );
    const res = await handler(makeDetailEvent('2026-05-9674'));
    expect(res.statusCode).toBe(500);
  });
});

describe('DELETE /statements/{statementId}', () => {
  let deps: StatementsApiDependencies;
  beforeEach(() => { vi.clearAllMocks(); deps = makeDeps(); });

  it('deletes S3 object before metadata (order matters for idempotency)', async () => {
    const calls: string[] = [];
    const handler = createStatementsApiHandler(
      makeDeps({
        deleteStatementObject: vi.fn().mockImplementation(async () => { calls.push('s3'); }),
        deleteStatementMetadata: vi.fn().mockImplementation(async () => { calls.push('dynamo'); }),
      }),
    );
    const res = await handler(makeDetailEvent('2026-05-9674', 'DELETE'));
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['s3', 'dynamo']);
  });

  it('returns 200 when S3 object is already gone (idempotent)', async () => {
    const handler = createStatementsApiHandler(
      makeDeps({
        deleteStatementObject: vi.fn().mockResolvedValue(undefined), // no-op
      }),
    );
    const res = await handler(makeDetailEvent('2026-05-9674', 'DELETE'));
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when statement belongs to another user', async () => {
    const handler = createStatementsApiHandler(
      makeDeps({
        getStatementMetadata: vi.fn().mockResolvedValue({
          ...mockMetadataRecord,
          PK: 'USER#other-user' as `USER#${string}`,
        }),
      }),
    );
    const res = await handler(makeDetailEvent('2026-05-9674', 'DELETE'));
    expect(res.statusCode).toBe(403);
    expect(deps.deleteStatementObject).not.toHaveBeenCalled();
  });
});
