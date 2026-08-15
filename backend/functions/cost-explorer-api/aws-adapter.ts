import { ListBillingViewsCommand } from '@aws-sdk/client-billing';
import type {
  BillingViewListElement,
  ListBillingViewsResponse,
} from '@aws-sdk/client-billing';
import {
  GetCostAndUsageCommand,
  GetCostAndUsageComparisonsCommand,
  GetCostAndUsageWithResourcesCommand,
  GetCostCategoriesCommand,
  GetCostComparisonDriversCommand,
  GetCostForecastCommand,
  GetDimensionValuesCommand,
  GetTagsCommand,
  GetUsageForecastCommand,
} from '@aws-sdk/client-cost-explorer';
import type {
  ComparisonMetricValue,
  CostAndUsageComparison,
  CostComparisonDriver,
  Dimension,
  Expression,
  ForecastResult,
  GetCostAndUsageComparisonsResponse,
  GetCostAndUsageResponse,
  GetCostAndUsageWithResourcesResponse,
  GetCostCategoriesResponse,
  GetCostComparisonDriversResponse,
  GetCostForecastResponse,
  GetDimensionValuesResponse,
  GetTagsResponse,
  GetUsageForecastResponse,
  Metric,
  ResultByTime,
} from '@aws-sdk/client-cost-explorer';
import type {
  CostDimensionRequest,
  CostExplorerErrorCode,
  CostExplorerReportRequest,
  CostExplorerResult,
} from '@cashight/domain/aws-cost-explorer';

export interface AwsSender {
  send(command: never): Promise<unknown>;
}

export interface CostExplorerAwsAdapterDependencies {
  costExplorer: AwsSender;
  billing: AwsSender;
  now?: () => Date;
}

export type CompleteBreakdownRow = CostExplorerResult['breakdown'][number];

export interface CompleteCostExplorerResult
  extends Omit<CostExplorerResult, 'breakdown' | 'nextBreakdownCursor'> {
  breakdown: CompleteBreakdownRow[];
  pageCount: number;
}

export interface CostForecastResult {
  total: string;
  unit: string;
  periods: Array<{
    start: string;
    end: string;
    mean: string;
    lowerBound?: string;
    upperBound?: string;
  }>;
}

export interface CostComparisonResult {
  comparisons: Array<{
    groupValues: string[];
    metrics: Record<string, NormalizedComparisonMetric>;
  }>;
  total: Record<string, NormalizedComparisonMetric>;
  drivers: Array<{
    groupValues: string[];
    type?: string;
    name?: string;
    metrics: Record<string, NormalizedComparisonMetric>;
  }>;
  pageCount: number;
}

export interface NormalizedComparisonMetric {
  baseline: string;
  comparison: string;
  difference: string;
  unit: string;
}

export interface CostDimensionValue {
  value: string;
  attributes?: Record<string, string>;
}

export interface BillingViewSummary {
  arn: string;
  name: string;
  description?: string;
  type?: string;
}

export class CostExplorerAdapterError extends Error {
  constructor(
    public readonly code: CostExplorerErrorCode,
    public readonly requestId?: string,
  ) {
    super('AWS Cost Explorer request failed.');
    this.name = 'CostExplorerAdapterError';
  }
}

export async function collectAwsPages<T>(
  fetchPage: (token?: string) => Promise<{ items: T[]; nextToken?: string }>,
): Promise<{ items: T[]; pageCount: number }> {
  const items: T[] = [];
  let token: string | undefined;
  let pageCount = 0;

  do {
    const page = await fetchPage(token);
    items.push(...page.items);
    pageCount += 1;
    token = page.nextToken;
  } while (token);

  return { items, pageCount };
}

function sendAws<T>(sender: AwsSender, command: object): Promise<T> {
  return sender.send(command as never) as Promise<T>;
}

function awsTimePeriod(period: { start: string; end: string }) {
  return { Start: period.start, End: period.end };
}

function awsFilter(request: CostExplorerReportRequest): Expression | undefined {
  const expressions: Expression[] = [];
  if (request.filter) expressions.push(request.filter as Expression);
  if (request.showOnlyUntagged) {
    expressions.push({
      Tags: { Key: '', Values: [], MatchOptions: ['ABSENT'] },
    });
  }
  if (request.showOnlyUncategorized) {
    expressions.push({
      CostCategories: { Key: '', Values: [], MatchOptions: ['ABSENT'] },
    });
  }
  if (expressions.length === 0) return undefined;
  return expressions.length === 1 ? expressions[0] : { And: expressions };
}

function commonQueryInput(request: CostExplorerReportRequest) {
  return {
    TimePeriod: awsTimePeriod(request.timePeriod),
    Granularity: request.granularity,
    Metrics: [request.metric],
    GroupBy: request.groupBy.map((group) => ({
      Type: group.type,
      Key: group.key,
    })),
    Filter: awsFilter(request),
    BillingViewArn: request.billingViewArn,
  };
}

interface ParsedDecimal {
  integer: bigint;
  scale: number;
}

function parseDecimal(value: string): ParsedDecimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new CostExplorerAdapterError('INVALID_COST_QUERY');
  const fraction = match[3] ?? '';
  const digits = `${match[2]}${fraction}`;
  const integer = BigInt(`${match[1]}${digits}`);
  return { integer, scale: fraction.length };
}

function powerOfTen(exponent: number): bigint {
  return BigInt(10) ** BigInt(exponent);
}

function formatDecimal({ integer, scale }: ParsedDecimal): string {
  const negative = integer < BigInt(0);
  const absolute = negative ? -integer : integer;
  if (scale === 0) return `${negative ? '-' : ''}${absolute}`;
  const padded = absolute.toString().padStart(scale + 1, '0');
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function addDecimalStrings(left: string, right: string): string {
  const first = parseDecimal(left);
  const second = parseDecimal(right);
  const scale = Math.max(first.scale, second.scale);
  return formatDecimal({
    integer:
      first.integer * powerOfTen(scale - first.scale) +
      second.integer * powerOfTen(scale - second.scale),
    scale,
  });
}

function sumDecimalStrings(values: string[]): string {
  return values.reduce(addDecimalStrings, '0');
}

function compareDecimalStrings(left: string, right: string): number {
  const first = parseDecimal(left);
  const second = parseDecimal(right);
  const scale = Math.max(first.scale, second.scale);
  const leftInteger = first.integer * powerOfTen(scale - first.scale);
  const rightInteger = second.integer * powerOfTen(scale - second.scale);
  if (leftInteger < rightInteger) return -1;
  if (leftInteger > rightInteger) return 1;
  return 0;
}

function divideDecimalString(value: string, divisor: number): string {
  if (divisor <= 0) return '0';
  const parsed = parseDecimal(value);
  const precision = 12;
  return formatDecimal({
    integer:
      (parsed.integer * powerOfTen(precision)) / BigInt(divisor),
    scale: parsed.scale + precision,
  });
}

interface PeriodAccumulator {
  start: string;
  end: string;
  estimated: boolean;
  groups: Map<string, { groupValues: string[]; amount: string }>;
}

function normalizeQueryResults(
  request: CostExplorerReportRequest,
  awsResults: ResultByTime[],
  pageCount: number,
  now: Date,
): CompleteCostExplorerResult {
  const periodsByKey = new Map<string, PeriodAccumulator>();
  let unit = '';

  for (const awsPeriod of awsResults) {
    const start = awsPeriod.TimePeriod?.Start;
    const end = awsPeriod.TimePeriod?.End;
    if (!start || !end) throw new CostExplorerAdapterError('INVALID_COST_QUERY');
    const periodKey = `${start}/${end}`;
    const period = periodsByKey.get(periodKey) ?? {
      start,
      end,
      estimated: false,
      groups: new Map(),
    };
    period.estimated ||= awsPeriod.Estimated ?? false;

    const groups = awsPeriod.Groups ?? [];
    if (groups.length > 0) {
      for (const group of groups) {
        const metric = group.Metrics?.[request.metric];
        const amount = metric?.Amount ?? '0';
        unit ||= metric?.Unit ?? '';
        const groupValues = group.Keys ?? [];
        const groupKey = JSON.stringify(groupValues);
        const previous = period.groups.get(groupKey)?.amount;
        period.groups.set(groupKey, {
          groupValues,
          amount: previous === undefined ? amount : addDecimalStrings(previous, amount),
        });
      }
    } else {
      const metric = awsPeriod.Total?.[request.metric];
      const amount = metric?.Amount ?? '0';
      unit ||= metric?.Unit ?? '';
      const previous = period.groups.get('[]')?.amount;
      period.groups.set('[]', {
        groupValues: [],
        amount: previous === undefined ? amount : addDecimalStrings(previous, amount),
      });
    }
    periodsByKey.set(periodKey, period);
  }

  const periods = [...periodsByKey.values()].sort((left, right) =>
    left.start < right.start ? -1 : left.start > right.start ? 1 : 0,
  );
  const groupKeys = new Set<string>();
  for (const period of periods) {
    for (const groupKey of period.groups.keys()) groupKeys.add(groupKey);
  }

  const breakdown: CompleteBreakdownRow[] = [...groupKeys].map((groupKey) => {
    const firstGroup = periods
      .map((period) => period.groups.get(groupKey))
      .find((group) => group !== undefined);
    const values = periods.map(
      (period) => period.groups.get(groupKey)?.amount ?? '0',
    );
    return {
      groupValues: firstGroup?.groupValues ?? [],
      values,
      total: sumDecimalStrings(values),
      estimated: periods.some(
        (period) => period.estimated && period.groups.has(groupKey),
      ),
    };
  });
  breakdown.sort((left, right) => {
    const amountOrder = compareDecimalStrings(right.total, left.total);
    if (amountOrder !== 0) return amountOrder;
    return JSON.stringify(left.groupValues) < JSON.stringify(right.groupValues)
      ? -1
      : 1;
  });

  const top = breakdown.slice(0, 9);
  const remainder = breakdown.slice(9);
  const series: CostExplorerResult['series'] = top.map((row, index) => ({
    key: `series-${String(index + 1).padStart(2, '0')}`,
    label: (row.groupValues.join(' / ') || 'Total').slice(0, 512),
    values: row.values,
    total: row.total,
  }));
  if (remainder.length > 0) {
    series.push({
      key: 'Other',
      label: 'Other',
      values: periods.map((_, index) =>
        sumDecimalStrings(remainder.map((row) => row.values[index] ?? '0')),
      ),
      total: sumDecimalStrings(remainder.map((row) => row.total)),
    });
  }

  const total = sumDecimalStrings(breakdown.map((row) => row.total));
  return {
    source: 'AWS',
    asOf: now.toISOString(),
    currencyOrUnit: unit || 'USD',
    estimated: periods.some((period) => period.estimated),
    overview: {
      total,
      average: divideDecimalString(total, periods.length),
    },
    periods: periods.map((period) => ({
      start: period.start,
      end: period.end,
      estimated: period.estimated,
    })),
    series,
    breakdown,
    comparisonDrivers: [],
    pageCount,
  };
}

function awsErrorMetadata(error: unknown): { name: string; requestId?: string } {
  if (typeof error !== 'object' || error === null) return { name: 'UnknownError' };
  const candidate = error as {
    name?: unknown;
    $metadata?: { requestId?: unknown };
  };
  return {
    name: typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
    requestId:
      typeof candidate.$metadata?.requestId === 'string'
        ? candidate.$metadata.requestId
        : undefined,
  };
}

export function normalizeCostExplorerError(error: unknown): CostExplorerAdapterError {
  if (error instanceof CostExplorerAdapterError) return error;
  const { name, requestId } = awsErrorMetadata(error);
  const code: CostExplorerErrorCode =
    name === 'AccessDeniedException' || name === 'UnauthorizedException'
      ? 'AWS_COST_ACCESS_DENIED'
      : name === 'DataUnavailableException' ||
          name === 'CostExplorerNotEnabledException' ||
          name === 'BillingViewHealthStatusException'
        ? 'COST_EXPLORER_DISABLED'
        : name === 'ValidationException'
          ? 'INVALID_COST_QUERY'
          : name === 'ThrottlingException' ||
              name === 'LimitExceededException' ||
              name === 'TooManyRequestsException'
            ? 'AWS_COST_THROTTLED'
            : 'AWS_COST_QUERY_BUSY';
  return new CostExplorerAdapterError(code, requestId);
}

function comparisonMetrics(
  metrics: Record<string, ComparisonMetricValue> | undefined,
): Record<string, NormalizedComparisonMetric> {
  return Object.fromEntries(
    Object.entries(metrics ?? {}).map(([metric, value]) => [
      metric,
      {
        baseline: value.BaselineTimePeriodAmount ?? '0',
        comparison: value.ComparisonTimePeriodAmount ?? '0',
        difference: value.Difference ?? '0',
        unit: value.Unit ?? '',
      },
    ]),
  );
}

function expressionValues(expression: Expression | undefined): string[] {
  if (!expression) return [];
  if (expression.Dimensions) return expression.Dimensions.Values ?? [];
  if (expression.Tags) return expression.Tags.Values ?? [];
  if (expression.CostCategories) return expression.CostCategories.Values ?? [];
  if (expression.Not) return expressionValues(expression.Not);
  return (expression.And ?? expression.Or ?? []).flatMap(expressionValues);
}

function normalizeForecast(
  response: GetCostForecastResponse | GetUsageForecastResponse,
): CostForecastResult {
  return {
    total: response.Total?.Amount ?? '0',
    unit: response.Total?.Unit ?? '',
    periods: (response.ForecastResultsByTime ?? []).map(
      (period: ForecastResult) => ({
        start: period.TimePeriod?.Start ?? '',
        end: period.TimePeriod?.End ?? '',
        mean: period.MeanValue ?? '0',
        ...(period.PredictionIntervalLowerBound
          ? { lowerBound: period.PredictionIntervalLowerBound }
          : {}),
        ...(period.PredictionIntervalUpperBound
          ? { upperBound: period.PredictionIntervalUpperBound }
          : {}),
      }),
    ),
  };
}

function costForecastMetric(metric: CostExplorerReportRequest['metric']): Metric {
  const metrics: Record<CostExplorerReportRequest['metric'], Metric> = {
    AmortizedCost: 'AMORTIZED_COST',
    BlendedCost: 'BLENDED_COST',
    NetAmortizedCost: 'NET_AMORTIZED_COST',
    NetUnblendedCost: 'NET_UNBLENDED_COST',
    NormalizedUsageAmount: 'NORMALIZED_USAGE_AMOUNT',
    UnblendedCost: 'UNBLENDED_COST',
    UsageQuantity: 'USAGE_QUANTITY',
  };
  return metrics[metric];
}

export class CostExplorerAwsAdapter {
  constructor(private readonly deps: CostExplorerAwsAdapterDependencies) {}

  async query(request: CostExplorerReportRequest): Promise<CompleteCostExplorerResult> {
    try {
      const results = await collectAwsPages<ResultByTime>(async (token) => {
        const input = { ...commonQueryInput(request), NextPageToken: token };
        const response =
          request.mode === 'RESOURCE'
            ? await sendAws<GetCostAndUsageWithResourcesResponse>(
                this.deps.costExplorer,
                new GetCostAndUsageWithResourcesCommand(input),
              )
            : await sendAws<GetCostAndUsageResponse>(
                this.deps.costExplorer,
                new GetCostAndUsageCommand(input),
              );
        return {
          items: response.ResultsByTime ?? [],
          nextToken: response.NextPageToken,
        };
      });
      return normalizeQueryResults(
        request,
        results.items,
        results.pageCount,
        this.deps.now?.() ?? new Date(),
      );
    } catch (error) {
      throw normalizeCostExplorerError(error);
    }
  }

  async forecast(request: CostExplorerReportRequest): Promise<CostForecastResult> {
    const input = {
      TimePeriod: awsTimePeriod(request.timePeriod),
      Granularity: request.granularity === 'HOURLY' ? 'DAILY' : request.granularity,
      Metric: costForecastMetric(request.metric),
      Filter: awsFilter(request),
      BillingViewArn: request.billingViewArn,
      PredictionIntervalLevel: 80,
    };
    try {
      const response =
        request.metric === 'UsageQuantity' ||
        request.metric === 'NormalizedUsageAmount'
          ? await sendAws<GetUsageForecastResponse>(
              this.deps.costExplorer,
              new GetUsageForecastCommand(input),
            )
          : await sendAws<GetCostForecastResponse>(
              this.deps.costExplorer,
              new GetCostForecastCommand(input),
            );
      return normalizeForecast(response);
    } catch (error) {
      throw normalizeCostExplorerError(error);
    }
  }

  async compare(request: CostExplorerReportRequest): Promise<CostComparisonResult> {
    if (!request.comparisonTimePeriod) {
      throw new CostExplorerAdapterError('INVALID_COST_QUERY');
    }
    const commonInput = {
      BaselineTimePeriod: awsTimePeriod(request.comparisonTimePeriod),
      ComparisonTimePeriod: awsTimePeriod(request.timePeriod),
      MetricForComparison: request.metric,
      Filter: awsFilter(request),
      GroupBy: request.groupBy.map((group) => ({
        Type: group.type,
        Key: group.key,
      })),
      BillingViewArn: request.billingViewArn,
    };
    try {
      const [comparisons, drivers] = await Promise.all([
        collectAwsPages<GetCostAndUsageComparisonsResponse>(async (token) => {
          const page = await sendAws<GetCostAndUsageComparisonsResponse>(
            this.deps.costExplorer,
            new GetCostAndUsageComparisonsCommand({
              ...commonInput,
              NextPageToken: token,
            }),
          );
          return { items: [page], nextToken: page.NextPageToken };
        }),
        collectAwsPages<GetCostComparisonDriversResponse>(async (token) => {
          const page = await sendAws<GetCostComparisonDriversResponse>(
            this.deps.costExplorer,
            new GetCostComparisonDriversCommand({
              ...commonInput,
              NextPageToken: token,
            }),
          );
          return { items: [page], nextToken: page.NextPageToken };
        }),
      ]);

      const comparisonRows = comparisons.items.flatMap(
        (page) => page.CostAndUsageComparisons ?? [],
      );
      const driverRows = drivers.items.flatMap(
        (page) => page.CostComparisonDrivers ?? [],
      );
      return {
        comparisons: comparisonRows.map((row: CostAndUsageComparison) => ({
          groupValues: expressionValues(row.CostAndUsageSelector),
          metrics: comparisonMetrics(row.Metrics),
        })),
        total: comparisonMetrics(
          comparisons.items.find((page) => page.TotalCostAndUsage)
            ?.TotalCostAndUsage,
        ),
        drivers: driverRows.flatMap((row: CostComparisonDriver) =>
          (row.CostDrivers ?? []).map((driver) => ({
            groupValues: expressionValues(row.CostSelector),
            ...(driver.Type ? { type: driver.Type } : {}),
            ...(driver.Name ? { name: driver.Name } : {}),
            metrics: comparisonMetrics(driver.Metrics),
          })),
        ),
        pageCount: comparisons.pageCount + drivers.pageCount,
      };
    } catch (error) {
      throw normalizeCostExplorerError(error);
    }
  }

  async listValues(request: CostDimensionRequest): Promise<CostDimensionValue[]> {
    try {
      const values = await collectAwsPages<CostDimensionValue>(async (token) => {
        const commonInput = {
          TimePeriod: awsTimePeriod(request.timePeriod),
          SearchString: request.search,
          BillingViewArn: request.billingViewArn,
          NextPageToken: token,
        };
        if (request.type === 'DIMENSION') {
          const response = await sendAws<GetDimensionValuesResponse>(
            this.deps.costExplorer,
            new GetDimensionValuesCommand({
              ...commonInput,
              Dimension: request.key as Dimension,
              Context: 'COST_AND_USAGE',
            }),
          );
          return {
            items: (response.DimensionValues ?? []).flatMap((item) =>
              item.Value
                ? [{ value: item.Value, ...(item.Attributes ? { attributes: item.Attributes } : {}) }]
                : [],
            ),
            nextToken: response.NextPageToken,
          };
        }
        if (request.type === 'TAG') {
          const response = await sendAws<GetTagsResponse>(
            this.deps.costExplorer,
            new GetTagsCommand({ ...commonInput, TagKey: request.key }),
          );
          return {
            items: (response.Tags ?? []).map((value) => ({ value })),
            nextToken: response.NextPageToken,
          };
        }
        const response = await sendAws<GetCostCategoriesResponse>(
          this.deps.costExplorer,
          new GetCostCategoriesCommand({
            ...commonInput,
            CostCategoryName: request.key,
          }),
        );
        return {
          items: (response.CostCategoryValues ?? []).map((value) => ({ value })),
          nextToken: response.NextPageToken,
        };
      });

      return [...new Map(values.items.map((item) => [item.value, item])).values()].sort(
        (left, right) => (left.value < right.value ? -1 : left.value > right.value ? 1 : 0),
      );
    } catch (error) {
      throw normalizeCostExplorerError(error);
    }
  }

  async listBillingViews(): Promise<BillingViewSummary[]> {
    try {
      const views = await collectAwsPages<BillingViewListElement>(async (token) => {
        const response = await sendAws<ListBillingViewsResponse>(
          this.deps.billing,
          new ListBillingViewsCommand({ nextToken: token }),
        );
        return { items: response.billingViews ?? [], nextToken: response.nextToken };
      });
      return views.items.flatMap((view) =>
        view.arn && view.name
          ? [
              {
                arn: view.arn,
                name: view.name,
                ...(view.description ? { description: view.description } : {}),
                ...(view.billingViewType ? { type: view.billingViewType } : {}),
              },
            ]
          : [],
      );
    } catch (error) {
      throw normalizeCostExplorerError(error);
    }
  }
}
