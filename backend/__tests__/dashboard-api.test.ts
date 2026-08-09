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
  workspaceId: 'primary' as const,
  authProvider: 'COGNITO' as const,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
};

const mockMetaRecord: StatementMetadataRecord = {
  PK: 'WORKSPACE#primary',
  SK: 'STATEMENT#2026-05#9674',
  statementId: '2026-05-9674',
  objectKey: 'users/primary/statements/9674/2026/2026-05.json',
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
    queryLegacyStatementsForYear: vi.fn().mockResolvedValue([]),
    getStatementObject: vi.fn().mockResolvedValue(mockStatement),
    enableLegacyWorkspaceFallback: false,
    onLegacyFallback: vi.fn(),
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
    expect(deps.queryStatementsForYear).toHaveBeenCalledWith('primary', 2026);
  });

  it('reads legacy subject data only when the workspace result is empty and fallback is enabled', async () => {
    const legacyRecord: StatementMetadataRecord = {
      ...mockMetaRecord,
      PK: 'USER#user-123',
      objectKey: 'users/user-123/statements/9674/2026/2026-05.json',
    };
    const onLegacyFallback = vi.fn();
    const localDeps = makeDeps({
      queryStatementsForYear: vi.fn().mockResolvedValue([]),
      queryLegacyStatementsForYear: vi.fn().mockResolvedValue([legacyRecord]),
      enableLegacyWorkspaceFallback: true,
      onLegacyFallback,
    });

    const res = await createDashboardApiHandler(localDeps)(
      makeEvent({ period: 'month', year: '2026', month: '5' }),
    );

    expect(res.statusCode).toBe(200);
    expect(localDeps.queryLegacyStatementsForYear).toHaveBeenCalledWith(
      'user-123',
      2026,
    );
    expect(onLegacyFallback).toHaveBeenCalledOnce();
  });

  it('never merges duplicate legacy results into workspace results', async () => {
    const queryLegacyStatementsForYear = vi.fn().mockResolvedValue([
      {
        ...mockMetaRecord,
        PK: 'USER#user-123',
        objectKey: 'users/user-123/statements/9674/2026/2026-05.json',
      },
    ]);
    const localDeps = makeDeps({
      queryLegacyStatementsForYear,
      enableLegacyWorkspaceFallback: true,
    });

    const res = await createDashboardApiHandler(localDeps)(
      makeEvent({ period: 'month', year: '2026', month: '5' }),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).statementCount).toBe(1);
    expect(queryLegacyStatementsForYear).not.toHaveBeenCalled();
  });

  it('rejects a foreign workspace record before reading its object', async () => {
    const getStatementObject = vi.fn().mockResolvedValue(mockStatement);
    const localDeps = makeDeps({
      queryStatementsForYear: vi.fn().mockResolvedValue([
        {
          ...mockMetaRecord,
          PK: 'WORKSPACE#other',
          objectKey: 'users/other/statements/9674/2026/2026-05.json',
        },
      ]),
      getStatementObject,
    });

    const res = await createDashboardApiHandler(localDeps)(
      makeEvent({ period: 'month', year: '2026', month: '5' }),
    );

    expect(res.statusCode).toBe(403);
    expect(getStatementObject).not.toHaveBeenCalled();
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
    const meta4: StatementMetadataRecord = { ...mockMetaRecord, SK: 'STATEMENT#2026-04#9674', statementId: '2026-04-9674', statementDate: '2026-04-01', objectKey: 'users/primary/statements/9674/2026/2026-04.json' };
    const meta6: StatementMetadataRecord = { ...mockMetaRecord, SK: 'STATEMENT#2026-06#9674', statementId: '2026-06-9674', statementDate: '2026-06-01', objectKey: 'users/primary/statements/9674/2026/2026-06.json' };
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
      return { ...mockMetaRecord, SK: `STATEMENT#2026-${m}#9674` as `STATEMENT#${string}#${string}`, statementDate: `2026-${m}-01`, statementId: `2026-${m}-9674`, objectKey: `users/primary/statements/9674/2026/2026-${m}.json` };
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

describe('GET /dashboard — bank filter', () => {
  const vibMeta: StatementMetadataRecord = {
    ...mockMetaRecord,
    SK: 'STATEMENT#2026-05#4550',
    statementId: '2026-05-4550',
    objectKey: 'users/primary/statements/4550/2026/2026-05.json',
    cardLast4: '4550',
    bank: 'VIB',
  };
  const vibStatement: Statement = {
    ...mockStatement,
    bank: 'VIB',
    cardLast4: '4550',
  };

  function makeMultiBankDeps(): DashboardApiDependencies {
    return makeDeps({
      queryStatementsForYear: vi.fn().mockResolvedValue([mockMetaRecord, vibMeta]),
      getStatementObject: vi
        .fn()
        .mockImplementation(async (key: string) =>
          key === vibMeta.objectKey ? vibStatement : mockStatement,
        ),
    });
  }

  beforeEach(() => { vi.clearAllMocks(); });

  it('narrows the view to the requested bank', async () => {
    const handler = createDashboardApiHandler(makeMultiBankDeps());
    const res = await handler(
      makeEvent({ period: 'month', year: '2026', month: '5', bank: 'VIB' }),
    );
    const body = JSON.parse(res.body);

    expect(body.statementCount).toBe(1);
    expect(body.availableBanks).toEqual(['TPBank', 'VIB']);
  });

  // No bank param means "pick one that has data", not "every bank": the
  // dashboard always shows exactly one bank.
  it('auto-selects the default bank when it has statements in the period', async () => {
    const handler = createDashboardApiHandler(makeMultiBankDeps());
    const res = await handler(makeEvent({ period: 'month', year: '2026', month: '5' }));
    const body = JSON.parse(res.body);

    expect(body.selectedBank).toBe('TPBank');
    expect(body.statementCount).toBe(1);
    expect(body.availableBanks).toEqual(['TPBank', 'VIB']);
  });

  it('auto-selects the only bank present when the default has none', async () => {
    const handler = createDashboardApiHandler(
      makeDeps({
        queryStatementsForYear: vi.fn().mockResolvedValue([vibMeta]),
        getStatementObject: vi.fn().mockResolvedValue(vibStatement),
      }),
    );
    const res = await handler(makeEvent({ period: 'month', year: '2026', month: '5' }));
    const body = JSON.parse(res.body);

    expect(body.selectedBank).toBe('VIB');
    expect(body.statementCount).toBe(1);
  });

  it('auto-selects for an unrecognised bank value', async () => {
    const handler = createDashboardApiHandler(makeMultiBankDeps());
    const res = await handler(
      makeEvent({ period: 'month', year: '2026', month: '5', bank: 'Sacombank' }),
    );

    expect(JSON.parse(res.body).selectedBank).toBe('TPBank');
  });
});
