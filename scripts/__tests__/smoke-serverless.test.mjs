import { describe, expect, it } from 'vitest';

import {
  buildHistoricalCostExplorerRequest,
  inspectAwsInvoiceSmokeResponses,
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

  // A SHA-256 hex digest is 64 random hex characters, so a run of twelve
  // decimal digits inside it happens in roughly one digest in six. That run is
  // flanked by letters, not by the separators an account ID sits between.
  it('accepts a hex digest that happens to contain twelve consecutive digits', () => {
    const digest =
      'd40877f3a74a8d08fcf05a4cb6475270077f775d9a8a592732104475a821';
    expect(
      inspectCostExplorerSmokeResponses(
        response(200, { ...JSON.parse(queryResponse('AWS', '12.34').body), digest }),
        response(200, { ...JSON.parse(queryResponse('CACHE', '12.34').body), digest }),
        'short-lived-native-token',
      ),
    ).toEqual({ status: 'PASSED', total: '12.34' });
  });

  it('still rejects an account ID inside an ARN or a bare value', () => {
    for (const leaked of [
      { note: 'arn:aws:iam::123456789012:role/cashight' },
      { note: '123456789012' },
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

function invoiceResponse(status, body) {
  return { status, body: JSON.stringify(body) };
}

describe('serverless AWS invoice smoke validation', () => {
  const succeededJob = invoiceResponse(200, {
    job: {
      state: 'SUCCEEDED',
      yearMonth: '2026-07',
    },
  });
  const dashboard = invoiceResponse(200, {
    dashboard: {
      yearMonth: '2026-07',
      selected: {
        linkedAccounts: [{ accountLast4: '0001' }],
      },
      accountAllocations: [{ accountLast4: '0001', value: 44.2 }],
    },
  });
  const deleted = invoiceResponse(200, {
    yearMonth: '2026-07',
    deleted: true,
  });

  it('accepts success, masked dashboard data, and deletion', () => {
    expect(
      inspectAwsInvoiceSmokeResponses(succeededJob, dashboard, deleted),
    ).toEqual({ status: 'PASSED', yearMonth: '2026-07' });
  });

  it('accepts hex identifiers that happen to contain twelve consecutive digits', () => {
    expect(
      inspectAwsInvoiceSmokeResponses(
        succeededJob,
        invoiceResponse(200, {
          dashboard: {
            ...JSON.parse(dashboard.body).dashboard,
            digest: 'd40877f3a74a8d08fcf05a4cb6475270077f775d9a8a592732104475a821',
          },
        }),
        deleted,
      ),
    ).toEqual({ status: 'PASSED', yearMonth: '2026-07' });
  });

  it('still rejects an account ID inside an ARN', () => {
    expect(() =>
      inspectAwsInvoiceSmokeResponses(
        succeededJob,
        invoiceResponse(200, {
          dashboard: {
            ...JSON.parse(dashboard.body).dashboard,
            note: 'arn:aws:iam::123456789012:role/cashight',
          },
        }),
        deleted,
      ),
    ).toThrow('sensitive');
  });

  it('rejects terminal failures, unmasked IDs, and prohibited fields', () => {
    expect(() =>
      inspectAwsInvoiceSmokeResponses(
        invoiceResponse(200, { job: { state: 'FAILED' } }),
        dashboard,
        deleted,
      ),
    ).toThrow('SUCCEEDED');

    for (const leak of [
      { accountId: '123456789012' },
      { billTo: 'Private customer' },
      { rawText: 'private extraction' },
    ]) {
      expect(() =>
        inspectAwsInvoiceSmokeResponses(
          succeededJob,
          invoiceResponse(200, {
            dashboard: {
              ...JSON.parse(dashboard.body).dashboard,
              ...leak,
            },
          }),
          deleted,
        ),
      ).toThrow('sensitive');
    }
  });
});
