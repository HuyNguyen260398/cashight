import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CostDimensionRequest,
  CostExplorerReportRequest,
} from '@cashight/domain/aws-cost-explorer';
import { CostExplorerResultSchema } from '@cashight/domain/aws-cost-explorer';

import {
  CostExplorerAdapterError,
  CostExplorerAwsAdapter,
  collectAwsPages,
} from '../functions/cost-explorer-api/aws-adapter';
import { createCostExplorerClients } from '../shared/cost-explorer-clients';

const standardRequest: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-06-01', end: '2026-07-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

type AwsCommand = {
  constructor: { name: string };
  input: Record<string, unknown>;
};

function clientWithResponses(responses: Record<string, unknown>) {
  return {
    send: vi.fn(async (command: AwsCommand) => {
      const response = responses[command.constructor.name];
      if (response instanceof Error) throw response;
      return response ?? {};
    }),
  };
}

describe('collectAwsPages', () => {
  it('forwards every token in order and returns only after all pages succeed', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: ['one'], nextToken: 'page-2' })
      .mockResolvedValueOnce({ items: ['two'], nextToken: 'page-3' })
      .mockResolvedValueOnce({ items: ['three'] });

    await expect(collectAwsPages(fetchPage)).resolves.toEqual({
      items: ['one', 'two', 'three'],
      pageCount: 3,
    });
    expect(fetchPage.mock.calls).toEqual([[undefined], ['page-2'], ['page-3']]);
  });

  it('rejects the entire retrieval when a later page fails', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: ['one'], nextToken: 'page-2' })
      .mockResolvedValueOnce({ items: ['two'], nextToken: 'page-3' })
      .mockRejectedValueOnce(new Error('page failed'));

    await expect(collectAwsPages(fetchPage)).rejects.toThrow('page failed');
  });
});

describe('CostExplorerAwsAdapter command mapping', () => {
  const responses = {
    GetCostAndUsageCommand: { ResultsByTime: [] },
    GetCostAndUsageWithResourcesCommand: { ResultsByTime: [] },
    GetCostForecastCommand: {
      Total: { Amount: '0', Unit: 'USD' },
      ForecastResultsByTime: [],
    },
    GetUsageForecastCommand: {
      Total: { Amount: '0', Unit: 'Hours' },
      ForecastResultsByTime: [],
    },
    GetCostAndUsageComparisonsCommand: { CostAndUsageComparisons: [] },
    GetCostComparisonDriversCommand: { CostComparisonDrivers: [] },
    GetDimensionValuesCommand: { DimensionValues: [] },
    GetTagsCommand: { Tags: [] },
    GetCostCategoriesCommand: { CostCategoryValues: [] },
    ListBillingViewsCommand: { billingViews: [] },
  };

  let costExplorer: ReturnType<typeof clientWithResponses>;
  let billing: ReturnType<typeof clientWithResponses>;
  let adapter: CostExplorerAwsAdapter;

  beforeEach(() => {
    costExplorer = clientWithResponses(responses);
    billing = clientWithResponses(responses);
    adapter = new CostExplorerAwsAdapter({
      costExplorer,
      billing,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
    });
  });

  it('uses standard and resource cost commands with canonical AWS inputs', async () => {
    await adapter.query(standardRequest);
    await adapter.query({
      ...standardRequest,
      mode: 'RESOURCE',
      groupBy: [{ type: 'DIMENSION', key: 'RESOURCE_ID' }],
    });

    expect(costExplorer.send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'GetCostAndUsageCommand',
      'GetCostAndUsageWithResourcesCommand',
    ]);
    expect(costExplorer.send.mock.calls[0][0].input).toMatchObject({
      TimePeriod: { Start: '2026-06-01', End: '2026-07-01' },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });
  });

  it('maps cost and usage forecasts to distinct AWS commands', async () => {
    await adapter.forecast({ ...standardRequest, groupBy: [] });
    await adapter.forecast({
      ...standardRequest,
      groupBy: [],
      metric: 'UsageQuantity',
    });

    expect(costExplorer.send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'GetCostForecastCommand',
      'GetUsageForecastCommand',
    ]);
  });

  it('retrieves both comparison result families', async () => {
    await adapter.compare({
      ...standardRequest,
      mode: 'COMPARISON',
      comparisonTimePeriod: { start: '2026-05-01', end: '2026-06-01' },
    });

    expect(costExplorer.send.mock.calls.map(([command]) => command.constructor.name).sort()).toEqual([
      'GetCostAndUsageComparisonsCommand',
      'GetCostComparisonDriversCommand',
    ]);
  });

  it.each([
    ['DIMENSION', 'SERVICE', 'GetDimensionValuesCommand'],
    ['TAG', 'Environment', 'GetTagsCommand'],
    ['COST_CATEGORY', 'Team', 'GetCostCategoriesCommand'],
  ] as const)('maps %s value searches to %s', async (type, key, commandName) => {
    const request: CostDimensionRequest = {
      type,
      key,
      timePeriod: standardRequest.timePeriod,
      search: 'prod',
    };

    await adapter.listValues(request);

    expect(costExplorer.send.mock.calls[0][0].constructor.name).toBe(commandName);
  });

  it('uses the Billing client and strips owner account identifiers from views', async () => {
    billing = clientWithResponses({
      ListBillingViewsCommand: {
        billingViews: [
          {
            arn: 'arn:aws:billing::123456789012:billingview/primary',
            name: 'Primary',
            ownerAccountId: '123456789012',
            sourceAccountId: '210987654321',
            billingViewType: 'PRIMARY',
          },
        ],
      },
    });
    adapter = new CostExplorerAwsAdapter({ costExplorer, billing });

    const views = await adapter.listBillingViews();

    expect(billing.send.mock.calls[0][0].constructor.name).toBe(
      'ListBillingViewsCommand',
    );
    expect(views).toEqual([
      {
        arn: 'arn:aws:billing::123456789012:billingview/primary',
        name: 'Primary',
        type: 'PRIMARY',
      },
    ]);
    expect(views[0]).not.toHaveProperty('ownerAccountId');
  });
});

describe('CostExplorerAwsAdapter normalization', () => {
  it('keeps complete breakdown data and calculates top-nine-plus-Other without float loss', async () => {
    const groups = [
      { Keys: ['group-1'], Metrics: { UnblendedCost: { Amount: '0.1', Unit: 'USD' } } },
      { Keys: ['group-2'], Metrics: { UnblendedCost: { Amount: '0.2', Unit: 'USD' } } },
      ...Array.from({ length: 9 }, (_, index) => ({
        Keys: [`group-${index + 3}`],
        Metrics: {
          UnblendedCost: { Amount: String(index + 3), Unit: 'USD' },
        },
      })),
    ];
    const costExplorer = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          ResultsByTime: [
            {
              TimePeriod: { Start: '2026-06-01', End: '2026-07-01' },
              Estimated: false,
              Groups: groups.slice(0, 6),
            },
          ],
          NextPageToken: 'page-2',
        })
        .mockResolvedValueOnce({
          ResultsByTime: [
            {
              TimePeriod: { Start: '2026-06-01', End: '2026-07-01' },
              Estimated: false,
              Groups: groups.slice(6),
            },
          ],
        }),
    };
    const adapter = new CostExplorerAwsAdapter({
      costExplorer,
      billing: clientWithResponses({}),
      now: () => new Date('2026-08-03T12:00:00.000Z'),
    });

    const result = await adapter.query(standardRequest);

    expect(result.breakdown).toHaveLength(11);
    expect(result.series).toHaveLength(10);
    expect(result.series.at(-1)).toMatchObject({
      key: 'Other',
      values: ['0.3'],
      total: '0.3',
    });
    expect(result.overview.total).toBe('63.3');
    expect(result.pageCount).toBe(2);
  });

  it('keeps chart series identifiers and labels within the public result contract', async () => {
    const longValue = 'a'.repeat(300);
    const costExplorer = clientWithResponses({
      GetCostAndUsageCommand: {
        ResultsByTime: [
          {
            TimePeriod: { Start: '2026-06-01', End: '2026-07-01' },
            Groups: [
              {
                Keys: [longValue, longValue],
                Metrics: {
                  UnblendedCost: { Amount: '1.0', Unit: 'USD' },
                },
              },
            ],
          },
        ],
      },
    });
    const adapter = new CostExplorerAwsAdapter({
      costExplorer,
      billing: clientWithResponses({}),
      now: () => new Date('2026-08-03T12:00:00.000Z'),
    });

    const { pageCount, ...result } = await adapter.query(standardRequest);

    expect(pageCount).toBe(1);
    expect(() => CostExplorerResultSchema.parse(result)).not.toThrow();
    expect(result.breakdown[0].values).toEqual(['1.0']);
  });
});

describe('Cost Explorer error normalization', () => {
  it.each([
    ['AccessDeniedException', 'AWS_COST_ACCESS_DENIED'],
    ['DataUnavailableException', 'COST_EXPLORER_DISABLED'],
    ['ValidationException', 'INVALID_COST_QUERY'],
    ['ThrottlingException', 'AWS_COST_THROTTLED'],
    ['ServiceUnavailableException', 'AWS_COST_QUERY_BUSY'],
  ] as const)('maps %s without retaining sensitive AWS messages', async (name, code) => {
    const awsError = Object.assign(new Error('secret-filter-value'), {
      name,
      $metadata: { requestId: 'aws-request-id' },
    });
    const adapter = new CostExplorerAwsAdapter({
      costExplorer: clientWithResponses({ GetCostAndUsageCommand: awsError }),
      billing: clientWithResponses({}),
    });

    const operation = adapter.query(standardRequest);

    await expect(operation).rejects.toMatchObject({
      code,
      requestId: 'aws-request-id',
    });
    await expect(operation).rejects.not.toThrow('secret-filter-value');
    await expect(operation).rejects.toBeInstanceOf(CostExplorerAdapterError);
  });
});

describe('createCostExplorerClients', () => {
  it('creates both clients for the Cost Explorer us-east-1 endpoint only when invoked', async () => {
    const clients = createCostExplorerClients();

    await expect(clients.costExplorer.config.region()).resolves.toBe('us-east-1');
    await expect(clients.billing.config.region()).resolves.toBe('us-east-1');
  });
});
