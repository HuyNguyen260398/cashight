import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { describe, expect, it, vi } from 'vitest';

import type { CompleteCostExplorerResult } from '../functions/cost-explorer-api/aws-adapter';
import { CostExplorerAdapterError } from '../functions/cost-explorer-api/aws-adapter';
import {
  createCostExplorerApiHandler,
  type CostExplorerApiDependencies,
} from '../functions/cost-explorer-api/handler';
import { createLocalCostExplorerDependencies } from '../../scripts/local/handlers';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const DIGEST = 'a'.repeat(64);

const reportRequest: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-01-01', end: '2026-03-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

const completeResult: CompleteCostExplorerResult = {
  source: 'AWS',
  asOf: '2026-08-09T00:00:00.000Z',
  currencyOrUnit: 'USD',
  estimated: false,
  overview: { total: '3.30', average: '1.65' },
  periods: [
    { start: '2026-01-01', end: '2026-02-01', estimated: false },
    { start: '2026-02-01', end: '2026-03-01', estimated: false },
  ],
  series: [
    { key: 'Example Compute', label: 'Example Compute', values: ['1.10', '2.20'], total: '3.30' },
  ],
  breakdown: [
    {
      groupValues: ['Example Compute'],
      values: ['1.10', '2.20'],
      total: '3.30',
      estimated: false,
    },
  ],
  comparisonDrivers: [],
  pageCount: 2,
};

function authorizationRecord(authProvider: 'COGNITO' | 'GOOGLE') {
  return {
    PK: 'AUTHZ#user-123' as const,
    SK: 'PROFILE' as const,
    active: true as const,
    workspaceId: 'primary' as const,
    authProvider,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function event(
  method: string,
  path: string,
  body?: unknown,
  scope = 'cashight/read cashight/write',
): unknown {
  return {
    httpMethod: method,
    path,
    pathParameters: path.includes(REPORT_ID) ? { reportId: REPORT_ID } : {},
    body: body === undefined ? null : JSON.stringify(body),
    requestContext: {
      requestId: 'cost-request-123',
      authorizer: {
        claims: {
          sub: 'user-123',
          username: 'native-user',
          token_use: 'access',
          scope,
        },
      },
    },
  };
}

function dependencies(authProvider: 'COGNITO' | 'GOOGLE' = 'COGNITO') {
  const adapter = {
    query: vi.fn().mockResolvedValue(completeResult),
    forecast: vi.fn().mockResolvedValue({
      total: '4.00',
      unit: 'USD',
      periods: [],
    }),
    compare: vi.fn().mockResolvedValue({
      comparisons: [],
      total: {},
      drivers: [],
      pageCount: 2,
    }),
    listValues: vi.fn().mockResolvedValue([{ value: 'Example Compute' }]),
    listBillingViews: vi.fn().mockResolvedValue([]),
  };
  const cache = {
    getCachedCostResult: vi.fn().mockResolvedValue(undefined),
    putCachedCostResult: vi.fn().mockResolvedValue(undefined),
    claimManualRefresh: vi.fn().mockResolvedValue(true),
    getManualRefreshCooldown: vi.fn().mockResolvedValue(undefined),
    claimQueryExecution: vi.fn().mockResolvedValue('owner' as const),
    releaseQueryExecution: vi.fn().mockResolvedValue(undefined),
    waitForCachedCostResult: vi.fn().mockResolvedValue(undefined),
  };
  const reports = {
    listSavedReports: vi.fn().mockResolvedValue([]),
    putSavedReport: vi.fn().mockImplementation(async (_workspaceId, input) => ({
      reportId: input.reportId ?? REPORT_ID,
      name: input.name,
      request: input.request,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    })),
    deleteSavedReport: vi.fn().mockResolvedValue(true),
  };
  const exporter = {
    exportCsv: vi.fn().mockResolvedValue({
      downloadUrl: 'https://download.invalid/private.csv',
      expiresAt: '2026-08-09T00:05:00.000Z',
      fileName: 'cashight-cost-explorer-2026-08-09.csv',
    }),
  };
  const createAwsAdapter = vi.fn(() => adapter);
  const deps = {
    getAuthorizedUser: vi.fn().mockResolvedValue(authorizationRecord(authProvider)),
    createAwsAdapter,
    cache,
    reports,
    exporter,
    granularDataEnabled: false,
    now: () => new Date('2026-08-09T00:00:00.000Z'),
    queryDigest: vi.fn().mockResolvedValue(DIGEST),
  } satisfies CostExplorerApiDependencies;
  return { deps, adapter, cache, reports, exporter, createAwsAdapter };
}

function bodyOf(response: { body: string }) {
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe('Cost Explorer provider gate', () => {
  it.each([
    ['POST', '/aws/cost-explorer/query', { request: reportRequest }],
    ['POST', '/aws/cost-explorer/comparisons', { request: { ...reportRequest, mode: 'COMPARISON', comparisonTimePeriod: { start: '2025-11-01', end: '2026-01-01' } } }],
    ['POST', '/aws/cost-explorer/dimensions', { type: 'DIMENSION', key: 'SERVICE', timePeriod: reportRequest.timePeriod }],
    ['POST', '/aws/cost-explorer/forecast', { request: { ...reportRequest, groupBy: [] } }],
    ['POST', '/aws/cost-explorer/export', { request: reportRequest }],
    ['GET', '/aws/cost-explorer/reports', undefined],
    ['POST', '/aws/cost-explorer/reports', { name: 'Monthly services', request: reportRequest }],
    ['DELETE', `/aws/cost-explorer/reports/${REPORT_ID}`, undefined],
  ])('rejects Google before dependencies for %s %s', async (method, path, body) => {
    const { deps, cache, reports, exporter, createAwsAdapter } = dependencies('GOOGLE');

    const response = await createCostExplorerApiHandler(deps)(event(method, path, body));

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toEqual({
      error: {
        code: 'COGNITO_REAUTH_REQUIRED',
        message: 'Sign in with Cognito to access AWS Cost Explorer.',
        requestId: 'cost-request-123',
      },
    });
    expect(createAwsAdapter).not.toHaveBeenCalled();
    expect(cache.getCachedCostResult).not.toHaveBeenCalled();
    expect(reports.listSavedReports).not.toHaveBeenCalled();
    expect(exporter.exportCsv).not.toHaveBeenCalled();
  });
});

describe('Cost Explorer query coordination', () => {
  it('rejects semantic errors before cache or AWS access', async () => {
    const { deps, cache, createAwsAdapter } = dependencies();
    const invalid = { ...reportRequest, showForecast: true };

    const response = await createCostExplorerApiHandler(deps)(
      event('POST', '/aws/cost-explorer/query', { request: invalid }),
    );

    expect(response.statusCode).toBe(400);
    expect((bodyOf(response).error as { code: string }).code).toBe('INVALID_COST_QUERY');
    expect(cache.getCachedCostResult).not.toHaveBeenCalled();
    expect(createAwsAdapter).not.toHaveBeenCalled();
  });

  it('returns cache hits without constructing an AWS adapter', async () => {
    const { deps, cache, createAwsAdapter } = dependencies();
    cache.getCachedCostResult.mockResolvedValue({ ...completeResult, source: 'CACHE' });

    const response = await createCostExplorerApiHandler(deps)(
      event('POST', '/aws/cost-explorer/query', { request: reportRequest }),
    );

    expect(response.statusCode).toBe(200);
    expect((bodyOf(response).result as { source: string }).source).toBe('CACHE');
    expect(createAwsAdapter).not.toHaveBeenCalled();
    expect(cache.putCachedCostResult).not.toHaveBeenCalled();
  });

  it('publishes only a complete successful AWS result and releases the lock', async () => {
    const { deps, adapter, cache } = dependencies();

    const response = await createCostExplorerApiHandler(deps)(
      event('POST', '/aws/cost-explorer/query', { request: reportRequest }),
    );

    expect(response.statusCode).toBe(200);
    expect(adapter.query).toHaveBeenCalledOnce();
    expect(cache.putCachedCostResult).toHaveBeenCalledWith(
      'primary',
      DIGEST,
      completeResult,
      1786320000,
    );
    expect(cache.releaseQueryExecution).toHaveBeenCalledWith(
      'primary',
      DIGEST,
      'cost-request-123',
    );
  });

  it('does not publish a result when the all-page AWS operation fails', async () => {
    const { deps, adapter, cache } = dependencies();
    adapter.query.mockRejectedValue(new CostExplorerAdapterError('AWS_COST_THROTTLED'));

    const response = await createCostExplorerApiHandler(deps)(
      event('POST', '/aws/cost-explorer/query', { request: reportRequest }),
    );

    expect(response.statusCode).toBe(503);
    expect(cache.putCachedCostResult).not.toHaveBeenCalled();
    expect(cache.releaseQueryExecution).toHaveBeenCalledOnce();
  });

  it('returns cached data and the cooldown time when refresh is already claimed', async () => {
    const { deps, cache, createAwsAdapter } = dependencies();
    cache.getCachedCostResult.mockResolvedValue({ ...completeResult, source: 'CACHE' });
    cache.claimManualRefresh.mockResolvedValue(false);
    cache.getManualRefreshCooldown.mockResolvedValue(1786233900);

    const response = await createCostExplorerApiHandler(deps)(
      event('POST', '/aws/cost-explorer/query', { request: reportRequest, refresh: true }),
    );

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response).refreshCooldownUntil).toBe('2026-08-09T00:05:00.000Z');
    expect(createAwsAdapter).not.toHaveBeenCalled();
  });

  it('waits for the lock owner and never starts a duplicate AWS query', async () => {
    const { deps, cache, createAwsAdapter } = dependencies();
    cache.claimQueryExecution.mockResolvedValue('wait');
    cache.waitForCachedCostResult.mockResolvedValue({ ...completeResult, source: 'CACHE' });

    const response = await createCostExplorerApiHandler(deps)(
      event('POST', '/aws/cost-explorer/query', { request: reportRequest }),
    );

    expect(response.statusCode).toBe(200);
    expect((bodyOf(response).result as { source: string }).source).toBe('CACHE');
    expect(createAwsAdapter).not.toHaveBeenCalled();
  });

  it('maps a lock wait timeout to a retryable busy error', async () => {
    const { deps, cache } = dependencies();
    cache.claimQueryExecution.mockResolvedValue('wait');

    const response = await createCostExplorerApiHandler(deps)(
      event('POST', '/aws/cost-explorer/query', { request: reportRequest }),
    );

    expect(response.statusCode).toBe(503);
    expect(bodyOf(response)).toEqual({
      error: {
        code: 'AWS_COST_QUERY_BUSY',
        message: 'The AWS cost query is already running. Try again shortly.',
        requestId: 'cost-request-123',
        retryable: true,
      },
    });
  });

  it('never reflects raw filters through mapped AWS failures', async () => {
    const { deps, adapter } = dependencies();
    adapter.query.mockRejectedValue(new CostExplorerAdapterError('AWS_COST_ACCESS_DENIED', 'aws-private-id'));
    const privateRequest = {
      ...reportRequest,
      filter: {
        Tags: { Key: 'private-tag-key', Values: ['private-tag-value'] },
      },
    };

    const response = await createCostExplorerApiHandler(deps)(
      event('POST', '/aws/cost-explorer/query', { request: privateRequest }),
    );
    const serialized = JSON.stringify(response);

    expect(response.statusCode).toBe(403);
    expect((bodyOf(response).error as { code: string }).code).toBe('AWS_COST_ACCESS_DENIED');
    expect(serialized).not.toContain('private-tag-key');
    expect(serialized).not.toContain('private-tag-value');
    expect(serialized).not.toContain('aws-private-id');
  });
});

describe('Cost Explorer route dispatch', () => {
  it('dispatches typed dimension, forecast, comparison, report, and export operations', async () => {
    const { deps, adapter, reports, exporter } = dependencies();
    const handler = createCostExplorerApiHandler(deps);
    const comparisonRequest = {
      ...reportRequest,
      mode: 'COMPARISON' as const,
      comparisonTimePeriod: { start: '2025-11-01', end: '2026-01-01' },
    };

    const responses = await Promise.all([
      handler(event('POST', '/aws/cost-explorer/dimensions', {
        type: 'DIMENSION',
        key: 'SERVICE',
        timePeriod: reportRequest.timePeriod,
      })),
      handler(event('POST', '/aws/cost-explorer/forecast', { request: { ...reportRequest, groupBy: [] } })),
      handler(event('POST', '/aws/cost-explorer/comparisons', { request: comparisonRequest })),
      handler(event('GET', '/aws/cost-explorer/reports')),
      handler(event('POST', '/aws/cost-explorer/reports', { name: 'Monthly services', request: reportRequest })),
      handler(event('DELETE', `/aws/cost-explorer/reports/${REPORT_ID}`)),
      handler(event('POST', '/aws/cost-explorer/export', { request: reportRequest })),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 201, 200, 200]);
    expect(adapter.listValues).toHaveBeenCalledOnce();
    expect(adapter.forecast).toHaveBeenCalledOnce();
    expect(adapter.compare).toHaveBeenCalledOnce();
    expect(reports.listSavedReports).toHaveBeenCalledWith('primary');
    expect(reports.putSavedReport).toHaveBeenCalledOnce();
    expect(reports.deleteSavedReport).toHaveBeenCalledWith('primary', REPORT_ID);
    expect(exporter.exportCsv).toHaveBeenCalledWith('primary', DIGEST, completeResult, reportRequest);
  });

  it('rejects unknown methods and subpaths before business dependencies', async () => {
    const { deps, createAwsAdapter } = dependencies();
    const handler = createCostExplorerApiHandler(deps);

    const wrongMethod = await handler(event('GET', '/aws/cost-explorer/query'));
    const wrongPath = await handler(event('POST', '/aws/cost-explorer/credentials', {}));

    expect(wrongMethod.statusCode).toBe(405);
    expect((bodyOf(wrongMethod).error as { code: string }).code).toBe('METHOD_NOT_ALLOWED');
    expect(wrongPath.statusCode).toBe(404);
    expect((bodyOf(wrongPath).error as { code: string }).code).toBe('NOT_FOUND');
    expect(createAwsAdapter).not.toHaveBeenCalled();
  });

  it('requires write scope for saved-report mutations', async () => {
    const { deps, reports } = dependencies();

    const response = await createCostExplorerApiHandler(deps)(
      event(
        'POST',
        '/aws/cost-explorer/reports',
        { name: 'Monthly services', request: reportRequest },
        'cashight/read',
      ),
    );

    expect(response.statusCode).toBe(403);
    expect(reports.putSavedReport).not.toHaveBeenCalled();
  });
});

describe('local Cost Explorer fixtures', () => {
  it('serves deterministic AWS-shaped fixtures with pagination and local mutations', async () => {
    const previousLocalDataDir = process.env.LOCAL_DATA_DIR;
    const dataDir = await mkdtemp(path.join(tmpdir(), 'cashight-cost-api-'));
    process.env.LOCAL_DATA_DIR = dataDir;
    try {
      const local = createLocalCostExplorerDependencies({
        apiBaseUrl: 'http://localhost:8787',
      });
      local.getAuthorizedUser = vi.fn().mockResolvedValue(authorizationRecord('COGNITO'));
      const handler = createCostExplorerApiHandler(local);

      const query = await handler(
        event('POST', '/aws/cost-explorer/query', { request: reportRequest }),
      );
      const forecast = await handler(
        event('POST', '/aws/cost-explorer/forecast', {
          request: { ...reportRequest, groupBy: [] },
        }),
      );
      const comparison = await handler(
        event('POST', '/aws/cost-explorer/comparisons', {
          request: {
            ...reportRequest,
            mode: 'COMPARISON',
            comparisonTimePeriod: { start: '2025-11-01', end: '2026-01-01' },
          },
        }),
      );
      const firstDimensions = await handler(
        event('POST', '/aws/cost-explorer/dimensions', {
          type: 'DIMENSION',
          key: 'SERVICE',
          timePeriod: reportRequest.timePeriod,
        }),
      );
      const firstDimensionBody = bodyOf(firstDimensions) as {
        items: unknown[];
        nextCursor: string;
      };
      const secondDimensions = await handler(
        event('POST', '/aws/cost-explorer/dimensions', {
          type: 'DIMENSION',
          key: 'SERVICE',
          timePeriod: reportRequest.timePeriod,
          cursor: firstDimensionBody.nextCursor,
        }),
      );
      const billingViews = await handler(
        event('POST', '/aws/cost-explorer/dimensions', { type: 'BILLING_VIEW' }),
      );
      const saved = await handler(
        event('POST', '/aws/cost-explorer/reports', {
          name: 'Local report',
          request: reportRequest,
        }),
      );
      const listed = await handler(event('GET', '/aws/cost-explorer/reports'));
      const exported = await handler(
        event('POST', '/aws/cost-explorer/export', { request: reportRequest }),
      );
      const ungroupedExport = await handler(
        event('POST', '/aws/cost-explorer/export', {
          request: { ...reportRequest, groupBy: [] },
        }),
      );

      expect(query.statusCode).toBe(200);
      expect(JSON.stringify(bodyOf(query))).toContain('Example Compute');
      expect(forecast.statusCode).toBe(200);
      expect(comparison.statusCode).toBe(200);
      expect(firstDimensionBody.items).toHaveLength(50);
      expect((bodyOf(secondDimensions).items as unknown[])).toHaveLength(10);
      expect(bodyOf(secondDimensions).nextCursor).toBeNull();
      expect((bodyOf(billingViews).billingViews as unknown[])).toHaveLength(2);
      expect(saved.statusCode).toBe(201);
      expect((bodyOf(listed).items as unknown[])).toHaveLength(1);
      expect(bodyOf(exported)).toEqual(expect.objectContaining({
        downloadUrl: expect.stringMatching(/^http:\/\/localhost:8787\/_local\/objects\/cost-exports\//),
        fileName: expect.stringMatching(/^cashight-cost-explorer-\d{4}-\d{2}-\d{2}\.csv$/),
      }));
      expect(ungroupedExport.statusCode).toBe(200);
    } finally {
      if (previousLocalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
      else process.env.LOCAL_DATA_DIR = previousLocalDataDir;
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
