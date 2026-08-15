import { describe, expect, it } from 'vitest';

import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import {
  canonicalizeCostExplorerRequest,
  costExplorerQueryDigest,
  validateCostExplorerSemantics,
} from '@cashight/domain/aws-cost-canonical';

const standardRequest: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-01-01', end: '2026-08-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  filter: {
    Or: [
      { Dimensions: { Key: 'REGION', Values: ['us-east-1', 'ap-southeast-1'] } },
      { Tags: { Key: 'Environment', Values: ['prod', 'dev'] } },
    ],
  },
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

describe('canonicalizeCostExplorerRequest', () => {
  it('canonicalizes reordered OR children, values, match options, and object keys identically', () => {
    const reordered: CostExplorerReportRequest = {
      showOnlyUncategorized: false,
      showOnlyUntagged: false,
      showForecast: false,
      chartStyle: 'STACK',
      filter: {
        Or: [
          {
            Tags: {
              Values: ['dev', 'prod'],
              Key: 'Environment',
            },
          },
          {
            Dimensions: {
              Values: ['ap-southeast-1', 'us-east-1'],
              Key: 'REGION',
            },
          },
        ],
      },
      groupBy: [{ key: 'SERVICE', type: 'DIMENSION' }],
      metric: 'UnblendedCost',
      granularity: 'MONTHLY',
      timePeriod: { end: '2026-08-01', start: '2026-01-01' },
      mode: 'STANDARD',
    };

    expect(canonicalizeCostExplorerRequest(reordered)).toBe(
      canonicalizeCostExplorerRequest(standardRequest),
    );
  });

  it('preserves group definition order because it changes output', () => {
    const first = {
      ...standardRequest,
      groupBy: [
        { type: 'DIMENSION' as const, key: 'SERVICE' },
        { type: 'DIMENSION' as const, key: 'REGION' },
      ],
    };
    const second = { ...first, groupBy: [...first.groupBy].reverse() };

    expect(canonicalizeCostExplorerRequest(first)).not.toBe(
      canonicalizeCostExplorerRequest(second),
    );
  });

  it('produces a deterministic SHA-256 digest without exposing the query', async () => {
    const digest = await costExplorerQueryDigest(standardRequest);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('Environment');
    expect(await costExplorerQueryDigest(standardRequest)).toBe(digest);
  });
});

describe('validateCostExplorerSemantics', () => {
  const preferences = {
    granularDataEnabled: true,
    currentDate: '2026-08-09',
  };

  it('allows hourly granularity only for an eligible resource query', () => {
    const invalid = validateCostExplorerSemantics(
      { ...standardRequest, granularity: 'HOURLY' },
      preferences,
    );
    expect(invalid).toMatchObject({
      valid: false,
      issues: [
        expect.objectContaining({
          path: 'granularity',
          code: 'GRANULARITY_NOT_AVAILABLE',
        }),
      ],
    });

    const eligible = validateCostExplorerSemantics(
      {
        ...standardRequest,
        mode: 'RESOURCE',
        timePeriod: { start: '2026-08-01', end: '2026-08-10' },
        granularity: 'HOURLY',
        groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
        filter: {
          Dimensions: {
            Key: 'SERVICE',
            Values: ['Amazon Elastic Compute Cloud - Compute'],
          },
        },
      },
      preferences,
    );
    expect(eligible.valid).toBe(true);
  });

  it('rejects granular reports when the operator preference is disabled', () => {
    const result = validateCostExplorerSemantics(
      {
        ...standardRequest,
        mode: 'RESOURCE',
        timePeriod: { start: '2026-08-01', end: '2026-08-10' },
        groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
        filter: {
          Dimensions: {
            Key: 'SERVICE',
            Values: ['Amazon Elastic Compute Cloud - Compute'],
          },
        },
      },
      { ...preferences, granularDataEnabled: false },
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: 'mode',
        code: 'GRANULARITY_NOT_AVAILABLE',
        severity: 'ERROR',
      }),
    );
  });

  it('enforces the 14-day resource range and eligible EC2 service filter', () => {
    const longRange = validateCostExplorerSemantics(
      {
        ...standardRequest,
        mode: 'RESOURCE',
        timePeriod: { start: '2026-07-20', end: '2026-08-05' },
        groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
      },
      preferences,
    );

    expect(longRange.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'timePeriod', severity: 'ERROR' }),
        expect.objectContaining({ path: 'filter', severity: 'ERROR' }),
      ]),
    );
  });

  it('rejects forecast with grouping before an AWS call', () => {
    const result = validateCostExplorerSemantics(
      { ...standardRequest, showForecast: true },
      preferences,
    );

    expect(result).toMatchObject({
      valid: false,
      issues: [
        expect.objectContaining({
          path: 'showForecast',
          code: 'INVALID_COST_QUERY',
        }),
      ],
    });
  });

  it.each([
    ['UsageQuantity', 'USAGE_UNIT_MAY_BE_MIXED'],
    ['NormalizedUsageAmount', 'NORMALIZED_USAGE_SCOPE_RECOMMENDED'],
  ] as const)('returns a non-blocking %s metric caveat', (metric, code) => {
    const result = validateCostExplorerSemantics(
      { ...standardRequest, metric },
      preferences,
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: 'metric', code, severity: 'WARNING' }),
    );
  });

  it('rejects resource data in comparison mode even for unparsed callers', () => {
    const result = validateCostExplorerSemantics(
      {
        ...standardRequest,
        mode: 'COMPARISON',
        comparisonTimePeriod: { start: '2025-12-01', end: '2026-01-01' },
        groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
      },
      preferences,
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: 'groupBy',
        code: 'INVALID_COST_QUERY',
        severity: 'ERROR',
      }),
    );
  });
});
