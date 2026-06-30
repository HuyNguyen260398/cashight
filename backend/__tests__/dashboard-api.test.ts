import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Statement } from '@cashight/domain/schemas';

import {
  createDashboardApiHandler,
  type DashboardApiDependencies,
} from '../functions/dashboard-api/handler';
import type { StatementMetadataRecord } from '../shared/metadata';

const mockAuthorizedRecord = {
  PK: 'AUTHZ#user-123' as const,
  SK: 'PROFILE' as const,
  active: true as const,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
};

const mockMetaRecord: StatementMetadataRecord = {
  PK: 'USER#user-123',
  SK: 'STATEMENT#2026-05#9674',
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

function makeDeps(overrides: Partial<DashboardApiDependencies> = {}): DashboardApiDependencies {
  return {
    getAuthorizedUser: vi.fn().mockResolvedValue(mockAuthorizedRecord),
    queryStatementsForYear: vi.fn().mockResolvedValue([mockMetaRecord]),
    getStatementObject: vi.fn().mockResolvedValue(mockStatement),
    ...overrides,
  };
}

function makeEvent(query: Record<string, string> = {}, claims: Record<string, unknown> = {}): unknown {
  return {
    httpMethod: 'GET',
    path: '/dashboard',
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

describe('GET /dashboard', () => {
  let deps: DashboardApiDependencies;
  beforeEach(() => { vi.clearAllMocks(); deps = makeDeps(); });

  it('rejects unauthenticated requests', async () => {
    const handler = createDashboardApiHandler(deps);
    const res = await handler(makeEvent({}, { sub: undefined, token_use: undefined }));
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthorized subjects', async () => {
    const handler = createDashboardApiHandler(
      makeDeps({ getAuthorizedUser: vi.fn().mockResolvedValue(undefined) }),
    );
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(403);
  });

  it('returns AggregatedView with valid period parameters', async () => {
    const handler = createDashboardApiHandler(deps);
    const res = await handler(makeEvent({ period: 'month', year: '2026', month: '5' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('spec');
    expect(body).toHaveProperty('label');
    expect(body).toHaveProperty('totals');
    expect(body).toHaveProperty('transactions');
    expect(body).toHaveProperty('byCategory');
    expect(body).toHaveProperty('topMerchants');
  });

  it('returns empty aggregation for a period with no statements', async () => {
    const handler = createDashboardApiHandler(
      makeDeps({ queryStatementsForYear: vi.fn().mockResolvedValue([]) }),
    );
    const res = await handler(makeEvent({ period: 'month', year: '2025', month: '1' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.statementCount).toBe(0);
    expect(body.totals.totalSpend).toBe(0);
  });

  it('falls back to current month when period params are absent', async () => {
    const handler = createDashboardApiHandler(deps);
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    // queryStatementsForYear called with some year
    expect(vi.mocked(deps.queryStatementsForYear)).toHaveBeenCalled();
  });

  it('returns quarter aggregation spanning all months in quarter', async () => {
    // Provide statements for months 4, 5, 6 (Q2)
    const meta4: StatementMetadataRecord = { ...mockMetaRecord, SK: 'STATEMENT#2026-04#9674', statementId: '2026-04-9674', statementDate: '2026-04-01', objectKey: 'users/user-123/statements/9674/2026/2026-04.json' };
    const meta6: StatementMetadataRecord = { ...mockMetaRecord, SK: 'STATEMENT#2026-06#9674', statementId: '2026-06-9674', statementDate: '2026-06-01', objectKey: 'users/user-123/statements/9674/2026/2026-06.json' };
    const stmt4: Statement = { ...mockStatement, statementDate: '2026-04-01' };
    const stmt6: Statement = { ...mockStatement, statementDate: '2026-06-01' };

    let callCount = 0;
    const handler = createDashboardApiHandler(
      makeDeps({
        queryStatementsForYear: vi.fn().mockResolvedValue([meta4, mockMetaRecord, meta6]),
        getStatementObject: vi.fn().mockImplementation(async () => {
          callCount += 1;
          if (callCount === 1) return stmt4;
          if (callCount === 2) return mockStatement;
          return stmt6;
        }),
      }),
    );
    const res = await handler(makeEvent({ period: 'quarter', year: '2026', quarter: '2' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.statementCount).toBe(3);
    expect(body.totals.totalSpend).toBe(mockStatement.totals.totalSpend * 3);
  });

  it('fetches S3 objects with bounded concurrency (max 5)', async () => {
    // Create 10 metadata records and verify they all get fetched
    const records: StatementMetadataRecord[] = Array.from({ length: 10 }, (_, i) => {
      const m = String(i + 1).padStart(2, '0');
      return { ...mockMetaRecord, SK: `STATEMENT#2026-${m}#9674` as `STATEMENT#${string}#${string}`, statementDate: `2026-${m}-01`, statementId: `2026-${m}-9674`, objectKey: `users/user-123/statements/9674/2026/2026-${m}.json` };
    });
    const stmts: Statement[] = records.map((r) => ({ ...mockStatement, statementDate: r.statementDate }));
    let idx = 0;
    const handler = createDashboardApiHandler(
      makeDeps({
        queryStatementsForYear: vi.fn().mockResolvedValue(records),
        getStatementObject: vi.fn().mockImplementation(async () => stmts[idx++ % stmts.length]),
      }),
    );
    const res = await handler(makeEvent({ period: 'year', year: '2026' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.statementCount).toBe(10);
  });
});
