import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { describe, expect, it } from 'vitest';

import { costUsageSeries } from '@/app/components/charts/cost-series';
import { formatPeriodLabel } from '@/app/components/aws-cost-explorer/cost-format';
import type { CostExplorerComparison, CostExplorerCompleteResult, CostExplorerForecast } from '@/frontend/api/contracts';

const request = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-05-01', end: '2026-07-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
} as unknown as CostExplorerReportRequest;

const result = {
  currencyOrUnit: 'USD',
  periods: [
    { start: '2026-05-01', end: '2026-06-01' },
    { start: '2026-06-01', end: '2026-07-01' },
  ],
  series: [
    { key: 'ec2', label: 'Amazon EC2', values: ['1.25', '2.50'], total: '3.75' },
    { key: 's3', label: 'Amazon S3', values: ['0.10', 'not-a-number'], total: '0.10' },
  ],
} as unknown as CostExplorerCompleteResult;

const forecast = {
  total: '9', unit: 'USD',
  periods: [{ start: '2026-07-01', end: '2026-08-01', mean: '4.50', lowerBound: '4', upperBound: '5' }],
} as CostExplorerForecast;

const may = formatPeriodLabel('2026-05-01', 'MONTHLY');
const june = formatPeriodLabel('2026-06-01', 'MONTHLY');
const july = formatPeriodLabel('2026-07-01', 'MONTHLY');

describe('costUsageSeries', () => {
  it('maps periods to categories and series values to numbers', () => {
    const out = costUsageSeries({ request, result, forecast: null, comparison: null, chartStyle: 'BAR' });
    expect(out.categories).toEqual([may, june]);
    expect(out.series.map((s) => [s.name, s.type, s.data])).toEqual([
      ['Amazon EC2', 'column', [1.25, 2.5]],
      ['Amazon S3', 'column', [0.1, 0]],
    ]);
    expect(out.stacking).toBeUndefined();
    expect(out.ariaLabel).toBe('Bar chart of UnblendedCost across 2 periods');
  });

  it('stacks columns for STACK and draws lines for LINE', () => {
    expect(costUsageSeries({ request, result, forecast: null, comparison: null, chartStyle: 'STACK' }).stacking).toBe('normal');
    const line = costUsageSeries({ request, result, forecast: null, comparison: null, chartStyle: 'LINE' });
    expect(line.series.every((s) => s.type === 'line')).toBe(true);
    expect(line.stacking).toBeUndefined();
    expect(line.ariaLabel).toMatch(/^Line chart/);
  });

  it('appends forecast periods as a dashed Forecast line', () => {
    const out = costUsageSeries({ request, result, forecast, comparison: null, chartStyle: 'STACK' });
    expect(out.categories).toEqual([may, june, july]);
    const fc = out.series.find((s) => s.name === 'Forecast')!;
    expect(fc).toMatchObject({ id: 'forecast', type: 'line', dashStyle: 'Dash', data: [null, null, 4.5] });
    expect(out.series.find((s) => s.name === 'Amazon EC2')!.data).toEqual([1.25, 2.5, null]);
  });

  it('gives every series a stable id so legend visibility survives a style change', () => {
    const a = costUsageSeries({ request, result, forecast: null, comparison: null, chartStyle: 'BAR' }).series.map((s) => s.id);
    const b = costUsageSeries({ request, result, forecast: null, comparison: null, chartStyle: 'LINE' }).series.map((s) => s.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(2);
  });

  it('maps a comparison to Baseline and Comparison columns per group', () => {
    const comparison = {
      total: { UnblendedCost: { baseline: '10', comparison: '12', unit: 'USD' } },
      comparisons: [
        { groupValues: ['Amazon EC2'], metrics: { UnblendedCost: { baseline: '7', comparison: '9' } } },
        { groupValues: [], metrics: { UnblendedCost: { baseline: '3', comparison: '3' } } },
      ],
    } as unknown as CostExplorerComparison;
    const out = costUsageSeries({ request, result: null, forecast: null, comparison, chartStyle: 'BAR' });
    expect(out.categories).toEqual(['Amazon EC2', 'Total']);
    expect(out.series.map((s) => [s.id, s.name, s.data])).toEqual([
      ['baseline', 'Baseline', [7, 3]],
      ['comparison', 'Comparison', [9, 3]],
    ]);
    expect(out.ariaLabel).toBe('Bar chart of UnblendedCost across 2 groups');
  });

  it('still charts a forecast when the report has no actual periods', () => {
    const empty = { ...result, periods: [], series: [] } as unknown as CostExplorerCompleteResult;
    const out = costUsageSeries({ request, result: empty, forecast, comparison: null, chartStyle: 'BAR' });
    expect(out.categories).toEqual([july]);
    expect(out.series).toEqual([expect.objectContaining({ id: 'forecast', data: [4.5] })]);
  });

  it('returns no series for an empty report', () => {
    const empty = { ...result, periods: [], series: [] } as unknown as CostExplorerCompleteResult;
    expect(costUsageSeries({ request, result: empty, forecast: null, comparison: null, chartStyle: 'BAR' }).series).toEqual([]);
    expect(costUsageSeries({ request, result: null, forecast: null, comparison: null, chartStyle: 'BAR' }).series).toEqual([]);
  });
});
