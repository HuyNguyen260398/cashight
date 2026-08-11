import { describe, expect, it } from 'vitest';

import {
  buildHistoricalCostExplorerRequest,
  inspectCostExplorerSmokeResponses,
  requireNativeAccessToken,
} from '../smoke-serverless.mjs';

function response(status, body) {
  return { status, body: JSON.stringify(body) };
}

function queryResponse(source, total, extra = {}) {
  return response(200, {
    digest: 'a'.repeat(64),
    result: {
      source,
      asOf: '2026-08-10T00:00:00.000Z',
      currencyOrUnit: 'USD',
      estimated: false,
      overview: { total, average: total },
      periods: [
        { start: '2026-07-01', end: '2026-08-01', estimated: false },
      ],
      series: [],
      breakdown: [],
      comparisonDrivers: [],
      pageCount: 1,
      ...extra,
    },
  });
}

describe('serverless Cost Explorer smoke validation', () => {
  it('requires native authentication when production smoke mode is enabled', () => {
    expect(() => requireNativeAccessToken('', true)).toThrow(
      'SMOKE_NATIVE_ACCESS_TOKEN is required',
    );
    expect(requireNativeAccessToken('short-lived-native-token', true)).toBe(
      'short-lived-native-token',
    );
    expect(requireNativeAccessToken('', false)).toBe('');
  });

  it('builds one bounded closed-month service query', () => {
    expect(
      buildHistoricalCostExplorerRequest(
        new Date('2026-08-10T12:00:00.000Z'),
      ),
    ).toEqual({
      mode: 'STANDARD',
      timePeriod: { start: '2026-07-01', end: '2026-08-01' },
      granularity: 'MONTHLY',
      metric: 'UnblendedCost',
      groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
      chartStyle: 'STACK',
      showForecast: false,
      showOnlyUntagged: false,
      showOnlyUncategorized: false,
    });
  });

  it('accepts AWS then CACHE responses with identical totals and safe fields', () => {
    expect(
      inspectCostExplorerSmokeResponses(
        queryResponse('AWS', '12.34'),
        queryResponse('CACHE', '12.34'),
        'short-lived-native-token',
      ),
    ).toEqual({ status: 'PASSED', total: '12.34' });
  });

  it('returns an explicit environment skip when Cost Explorer is disabled', () => {
    expect(
      inspectCostExplorerSmokeResponses(
        response(424, {
          error: {
            code: 'COST_EXPLORER_DISABLED',
            message: 'AWS Cost Explorer is not enabled.',
          },
        }),
        undefined,
        'short-lived-native-token',
      ),
    ).toEqual({
      status: 'SKIPPED',
      reason: 'AWS Cost Explorer is not enabled in the target account.',
    });
  });

  it('rejects provenance, total, token, account, and request-data leaks', () => {
    expect(() =>
      inspectCostExplorerSmokeResponses(
        queryResponse('CACHE', '12.34'),
        queryResponse('CACHE', '12.34'),
        'short-lived-native-token',
      ),
    ).toThrow('first query source AWS');

    expect(() =>
      inspectCostExplorerSmokeResponses(
        queryResponse('AWS', '12.34'),
        queryResponse('CACHE', '99.99'),
        'short-lived-native-token',
      ),
    ).toThrow('identical overview totals');

    for (const leaked of [
      { accessToken: 'short-lived-native-token' },
      { linkedAccount: '123456789012' },
      { request: { filter: { Tags: { Key: 'Owner', Values: ['Huy'] } } } },
    ]) {
      expect(() =>
        inspectCostExplorerSmokeResponses(
          queryResponse('AWS', '12.34', leaked),
          queryResponse('CACHE', '12.34'),
          'short-lived-native-token',
        ),
      ).toThrow('sensitive fields');
    }
  });
});
