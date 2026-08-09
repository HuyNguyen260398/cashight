import { describe, expect, it } from 'vitest';

import {
  CostDimensionRequestSchema,
  CostExplorerReportRequestSchema,
  CostExplorerResultSchema,
  SavedCostReportSchema,
} from '@cashight/domain/aws-cost-explorer';

const standardRequest = {
  mode: 'STANDARD' as const,
  timePeriod: { start: '2026-01-01', end: '2026-08-01' },
  granularity: 'MONTHLY' as const,
  metric: 'UnblendedCost' as const,
  groupBy: [{ type: 'DIMENSION' as const, key: 'SERVICE' }],
  chartStyle: 'STACK' as const,
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

describe('CostExplorerReportRequestSchema', () => {
  it('accepts a standard grouped cost report', () => {
    expect(CostExplorerReportRequestSchema.parse(standardRequest).groupBy).toHaveLength(1);
  });

  it('rejects a third group definition', () => {
    expect(() =>
      CostExplorerReportRequestSchema.parse({
        ...standardRequest,
        groupBy: [
          { type: 'DIMENSION', key: 'SERVICE' },
          { type: 'DIMENSION', key: 'REGION' },
          { type: 'TAG', key: 'Environment' },
        ],
      }),
    ).toThrow();
  });

  it.each([
    { start: '2026-02-30', end: '2026-03-01' },
    { start: '2026-03-01', end: '2026-03-01' },
    { start: '2026-03-02', end: '2026-03-01' },
  ])('rejects an invalid start-inclusive/end-exclusive interval: %o', (timePeriod) => {
    expect(() =>
      CostExplorerReportRequestSchema.parse({ ...standardRequest, timePeriod }),
    ).toThrow();
  });

  it('rejects filter nesting deeper than five expressions', () => {
    let filter: unknown = {
      Dimensions: { Key: 'SERVICE', Values: ['Amazon EC2'] },
    };
    for (let index = 0; index < 5; index += 1) filter = { Not: filter };

    expect(() =>
      CostExplorerReportRequestSchema.parse({ ...standardRequest, filter }),
    ).toThrow();
  });

  it('rejects more than 1,024 selected filter values across the expression', () => {
    const values = Array.from({ length: 1_025 }, (_, index) => `service-${index}`);

    expect(() =>
      CostExplorerReportRequestSchema.parse({
        ...standardRequest,
        filter: { Dimensions: { Key: 'SERVICE', Values: values } },
      }),
    ).toThrow();
  });

  it('rejects unsupported AWS match options', () => {
    expect(() =>
      CostExplorerReportRequestSchema.parse({
        ...standardRequest,
        filter: {
          Dimensions: {
            Key: 'SERVICE',
            Values: ['Amazon EC2'],
            MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          },
        },
      }),
    ).toThrow();
  });

  it('rejects resource mode unless RESOURCE_ID is grouped', () => {
    expect(() =>
      CostExplorerReportRequestSchema.parse({
        ...standardRequest,
        mode: 'RESOURCE',
      }),
    ).toThrow();
  });

  it('accepts resource mode grouped by RESOURCE_ID', () => {
    expect(
      CostExplorerReportRequestSchema.parse({
        ...standardRequest,
        mode: 'RESOURCE',
        groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
      }).mode,
    ).toBe('RESOURCE');
  });

  it('rejects hourly comparison and resource grouping in comparison mode', () => {
    const comparison = {
      ...standardRequest,
      mode: 'COMPARISON',
      comparisonTimePeriod: { start: '2025-12-01', end: '2026-01-01' },
    } as const;

    expect(() =>
      CostExplorerReportRequestSchema.parse({ ...comparison, granularity: 'HOURLY' }),
    ).toThrow();
    expect(() =>
      CostExplorerReportRequestSchema.parse({
        ...comparison,
        groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
      }),
    ).toThrow();
  });
});

describe('CostExplorerResultSchema', () => {
  const result = {
    source: 'AWS' as const,
    asOf: '2026-08-03T12:00:00.000Z',
    currencyOrUnit: 'USD',
    estimated: false,
    overview: {
      total: '123.4500000001',
      average: '61.72500000005',
    },
    periods: [
      { start: '2026-06-01', end: '2026-07-01', estimated: false },
      { start: '2026-07-01', end: '2026-08-01', estimated: false },
    ],
    series: [
      {
        key: 'Amazon EC2',
        label: 'Amazon EC2',
        values: ['100.0000000001', '23.45'],
        total: '123.4500000001',
      },
    ],
    breakdown: [
      {
        groupValues: ['Amazon EC2'],
        values: ['100.0000000001', '23.45'],
        total: '123.4500000001',
        estimated: false,
      },
    ],
    comparisonDrivers: [],
  };

  it('preserves decimal amount strings in normalized results', () => {
    expect(CostExplorerResultSchema.parse(result).overview.total).toBe('123.4500000001');
  });

  it('rejects more than 50 breakdown rows', () => {
    expect(() =>
      CostExplorerResultSchema.parse({
        ...result,
        breakdown: Array.from({ length: 51 }, () => result.breakdown[0]),
      }),
    ).toThrow();
  });

  it('accepts only a base64url cursor containing version, digest, and offset', () => {
    const cursor = Buffer.from(
      JSON.stringify({ version: 1, digest: 'a'.repeat(64), offset: 50 }),
    ).toString('base64url');

    expect(
      CostExplorerResultSchema.parse({ ...result, nextBreakdownCursor: cursor })
        .nextBreakdownCursor,
    ).toBe(cursor);
    expect(() =>
      CostExplorerResultSchema.parse({ ...result, nextBreakdownCursor: 'aws-token' }),
    ).toThrow();
  });
});

describe('saved reports and dimension requests', () => {
  it('trims and validates an owned saved report definition', () => {
    const report = SavedCostReportSchema.parse({
      reportId: '51ae8b2c-d0d4-4a49-87ee-662083d133f6',
      name: '  Monthly services  ',
      request: standardRequest,
      createdAt: '2026-08-03T12:00:00.000Z',
      updatedAt: '2026-08-03T12:00:00.000Z',
    });

    expect(report.name).toBe('Monthly services');
  });

  it('accepts a bounded searchable dimension request without account credentials', () => {
    const parsed = CostDimensionRequestSchema.parse({
      type: 'DIMENSION',
      key: 'SERVICE',
      timePeriod: standardRequest.timePeriod,
      search: 'compute',
      cursor: 'next-page',
    });

    expect(parsed).not.toHaveProperty('accountId');
    expect(parsed.search).toBe('compute');
  });
});
