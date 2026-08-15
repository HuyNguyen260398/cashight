import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { describe, expect, it } from 'vitest';

import {
  parseCostReportSearch,
  serializeCostReportSearch,
} from '../lib/aws-cost-explorer-url';

const defaults: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-08-01', end: '2026-08-11' },
  granularity: 'DAILY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

describe('Cost Explorer URL state', () => {
  it('round-trips every report field, repeated filter values, and two groups', () => {
    const report: CostExplorerReportRequest = {
      mode: 'COMPARISON',
      billingViewArn: 'arn:aws:billing::123456789012:billingview/example',
      timePeriod: { start: '2026-05-01', end: '2026-07-01' },
      comparisonTimePeriod: { start: '2026-03-01', end: '2026-05-01' },
      granularity: 'MONTHLY',
      metric: 'NetAmortizedCost',
      groupBy: [
        { type: 'DIMENSION', key: 'SERVICE' },
        { type: 'TAG', key: 'Môi trường' },
      ],
      filter: {
        And: [
          {
            Dimensions: {
              Key: 'REGION',
              Values: ['ap-southeast-1', 'us-east-1'],
              MatchOptions: ['EQUALS'],
            },
          },
          {
            Tags: {
              Key: 'Team',
              Values: ['Nền tảng', 'FinOps'],
              MatchOptions: ['EQUALS', 'CASE_SENSITIVE'],
            },
          },
        ],
      },
      chartStyle: 'LINE',
      showForecast: false,
      showOnlyUntagged: true,
      showOnlyUncategorized: true,
    };

    const search = serializeCostReportSearch(report);

    expect(search.get('start')).toBe('2026-05-01');
    expect(search.get('metric')).toBe('NetAmortizedCost');
    expect(search.get('granularity')).toBe('MONTHLY');
    expect(search.get('chart')).toBe('LINE');
    expect(search.get('filter')).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(search.getAll('group')).toEqual([
      'DIMENSION:SERVICE',
      'TAG:Môi trường',
    ]);
    expect(parseCostReportSearch(search, defaults)).toEqual(report);
  });

  it('uses the supplied defaults when report parameters are absent', () => {
    expect(parseCostReportSearch(new URLSearchParams(), defaults)).toEqual(
      defaults,
    );
  });

  it('preserves an explicitly ungrouped report', () => {
    const report = { ...defaults, groupBy: [] };

    const search = serializeCostReportSearch(report);

    expect(search.getAll('group')).toEqual(['none']);
    expect(parseCostReportSearch(search, defaults)).toEqual(report);
  });

  it('falls back atomically when encoded or readable state is malformed', () => {
    const invalidFilter = new URLSearchParams({
      start: '2026-01-01',
      end: '2026-02-01',
      filter: 'v1.not-base64!',
    });
    const invalidDate = new URLSearchParams({
      start: '2026-02-30',
      end: '2026-03-01',
    });

    expect(parseCostReportSearch(invalidFilter, defaults)).toEqual(defaults);
    expect(parseCostReportSearch(invalidDate, defaults)).toEqual(defaults);
  });

  it('rejects oversized decoded filter state before parsing JSON', () => {
    const oversized = new TextEncoder().encode(`{"value":"${'x'.repeat(70_000)}"}`);
    const encoded = btoa(String.fromCharCode(...oversized))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    expect(
      parseCostReportSearch(
        new URLSearchParams({ filter: `v1.${encoded}` }),
        defaults,
      ),
    ).toEqual(defaults);
  });

  it('discards token, credential, account, role, and region keys', () => {
    const search = serializeCostReportSearch(defaults);
    search.set('token', 'secret-token');
    search.set('access_token', 'secret-access-token');
    search.set('credentials', 'secret-credentials');
    search.set('accountId', '123456789012');
    search.set('roleArn', 'arn:aws:iam::123456789012:role/Admin');
    search.set('region', 'us-west-2');

    const parsed = parseCostReportSearch(search, defaults);
    const serialized = serializeCostReportSearch(parsed).toString();

    expect(parsed).toEqual(defaults);
    expect(serialized).not.toMatch(
      /secret|token|credential|account|role|region|123456789012/i,
    );
  });
});
