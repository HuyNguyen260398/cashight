'use client';

import { useMemo, useState } from 'react';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import {
  BarChart3,
  Layers,
  LineChart as LineChartIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  CostExplorerComparison,
  CostExplorerCompleteResult,
  CostExplorerForecast,
} from '@/frontend/api/contracts';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chart-colors';
import { cn } from '@/lib/utils';
import {
  decimalNumber,
  formatCompactCost,
  formatCostValue,
  formatPeriodLabel,
  displayGroupValues,
  displayGroupedLabel,
} from './cost-format';

const SERIES_COLORS = [
  CHART_COLORS.brand,
  CHART_COLORS.blueLight,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.purple,
  CHART_COLORS.pink,
  CHART_COLORS.orange,
  CHART_COLORS.brandLight,
  CHART_COLORS.successDark,
  CHART_COLORS.gray,
] as const;

interface GraphTooltipItem {
  name?: string | number;
  value?: string | number;
  color?: string;
}

export function CostGraphTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: GraphTooltipItem[];
  label?: string | number;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      role="tooltip"
      className="max-w-xs rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-theme-md dark:border-gray-700 dark:bg-gray-900"
    >
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {String(label ?? '')}
      </p>
      <div className="mt-1 space-y-1">
        {payload.map((item, index) => (
          <p
            key={`tooltip-${index}`}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span className="truncate text-gray-600 dark:text-gray-300">
              {String(item.name ?? '')}
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: item.color }}
            >
              {formatCostValue(Number(item.value ?? 0), unit)}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

type ChartStyle = CostExplorerReportRequest['chartStyle'];

function chartName(style: ChartStyle): string {
  if (style === 'STACK') return 'Stacked bar chart';
  if (style === 'LINE') return 'Line chart';
  return 'Bar chart';
}

const CHART_STYLES: ReadonlyArray<{ value: ChartStyle; label: string; Icon: LucideIcon }> = [
  { value: 'BAR', label: 'Bar', Icon: BarChart3 },
  { value: 'STACK', label: 'Stacked bar', Icon: Layers },
  { value: 'LINE', label: 'Line', Icon: LineChartIcon },
];

function ChartStyleToggle({
  value,
  onChange,
}: {
  value: ChartStyle;
  onChange: (style: ChartStyle) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Chart type"
      className="inline-flex rounded-lg border border-gray-200 p-1 dark:border-gray-700"
    >
      {CHART_STYLES.map(({ value: style, label, Icon }) => {
        const active = style === value;
        return (
          <button
            key={style}
            type="button"
            aria-pressed={active}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
              active
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
            )}
            onClick={() => onChange(style)}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function internalSeriesKey(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `series-${(hash >>> 0).toString(36)}`;
}

export function CostUsageGraph({
  request,
  result,
  forecast,
  comparison,
  chartStyle,
  onChartStyleChange,
}: {
  request: CostExplorerReportRequest;
  result: CostExplorerCompleteResult | null;
  forecast: CostExplorerForecast | null;
  comparison: CostExplorerComparison | null;
  /** Presentational override; falls back to the request's own style. */
  chartStyle?: ChartStyle;
  /** Omit to render the panel without the style toggle. */
  onChartStyleChange?: (style: ChartStyle) => void;
}) {
  const activeChartStyle = chartStyle ?? request.chartStyle;
  const comparisonMetricName = comparison
    ? Object.keys(comparison.total)[0]
    : undefined;
  const comparisonMetric = comparisonMetricName
    ? comparison?.total[comparisonMetricName]
    : undefined;
  const unit = result?.currencyOrUnit ?? comparisonMetric?.unit ?? forecast?.unit ?? 'USD';

  const standardSeries = useMemo(() => result?.series ?? [], [result?.series]);
  const standardData = useMemo(() => {
    if (!result) return [];
    const rows = result.periods.map((period, periodIndex) => {
      const row: Record<string, string | number> = {
        period: formatPeriodLabel(period.start, request.granularity),
      };
      result.series.forEach((series) => {
        row[internalSeriesKey(series.key)] = decimalNumber(
          series.values[periodIndex],
        );
      });
      return row;
    });
    if (!forecast) return rows;
    return [
      ...rows,
      ...forecast.periods.map((period) => ({
        period: formatPeriodLabel(period.start, request.granularity),
        forecast: decimalNumber(period.mean),
      })),
    ];
  }, [forecast, request.granularity, result]);

  const comparisonData = useMemo(() => {
    if (!comparison || !comparisonMetricName) return [];
    return comparison.comparisons.map((row) => ({
      period: displayGroupValues(row.groupValues, request.groupBy) || 'Total',
      baseline: decimalNumber(row.metrics[comparisonMetricName]?.baseline),
      comparison: decimalNumber(row.metrics[comparisonMetricName]?.comparison),
    }));
  }, [comparison, comparisonMetricName, request.groupBy]);

  const graphSeries = comparison
    ? [
        { key: 'baseline', label: 'Baseline', color: CHART_COLORS.gray },
        { key: 'comparison', label: 'Comparison', color: CHART_COLORS.brand },
      ]
    : [
        ...standardSeries.map((series, index) => ({
          key: internalSeriesKey(series.key),
          label: displayGroupedLabel(series.label, request.groupBy),
          color: SERIES_COLORS[index % SERIES_COLORS.length],
        })),
        ...(forecast
          ? [
              {
                key: 'forecast',
                label: 'Forecast',
                color: CHART_COLORS.warning,
              },
            ]
          : []),
      ];
  const datasetSignature = internalSeriesKey(
    JSON.stringify({
      request: {
        mode: request.mode,
        billingViewArn: request.billingViewArn,
        timePeriod: request.timePeriod,
        comparisonTimePeriod: request.comparisonTimePeriod,
        granularity: request.granularity,
        metric: request.metric,
        groupBy: request.groupBy,
        filter: request.filter,
        showForecast: request.showForecast,
        showOnlyUntagged: request.showOnlyUntagged,
        showOnlyUncategorized: request.showOnlyUncategorized,
      },
      dataset: comparison
        ? {
            mode: 'comparison',
            metric: comparisonMetricName,
            groups: comparison.comparisons.map((row) => row.groupValues),
          }
        : {
            mode: 'standard',
            series: standardSeries.map((series) => ({
              key: series.key,
              label: series.label,
            })),
            forecast: Boolean(forecast),
          },
    }),
  );
  const [legendState, setLegendState] = useState<{
    signature: string;
    hidden: Set<string>;
  }>(() => ({ signature: datasetSignature, hidden: new Set() }));
  const hiddenSeries =
    legendState.signature === datasetSignature
      ? legendState.hidden
      : new Set<string>();
  const data = comparison ? comparisonData : standardData;
  const visibleSeries = graphSeries.filter((series) => !hiddenSeries.has(series.key));
  const visibleBaseSeries = visibleSeries.filter(
    (series) => series.key !== 'forecast',
  );
  const forecastVisible = forecast && !hiddenSeries.has('forecast');
  const dataUnit = comparison ? 'group' : 'period';
  const label = `${chartName(activeChartStyle)} of ${request.metric} across ${data.length} ${data.length === 1 ? dataUnit : `${dataUnit}s`}`;

  const toggleSeries = (key: string) => {
    setLegendState((current) => {
      const next = new Set(
        current.signature === datasetSignature ? current.hidden : [],
      );
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { signature: datasetSignature, hidden: next };
    });
  };

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>
              <h2>Cost and usage graph</h2>
            </CardTitle>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {request.granularity.toLowerCase()} {request.metric} trend with exact AWS values.
            </p>
          </div>
          {onChartStyleChange ? (
            <ChartStyleToggle value={activeChartStyle} onChange={onChartStyleChange} />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.length === 0 || graphSeries.length === 0 ? (
          <div className="rounded-xl bg-gray-50 px-4 py-10 text-center dark:bg-white/[0.03]">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No cost data for this report.
            </p>
            {request.showForecast && !forecast ? (
              <p className="mt-2 text-sm font-medium text-warning-700 dark:text-warning-400">
                Forecast unavailable
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <div
              role="img"
              aria-label={label}
              className="cost-explorer-chart h-[320px] min-w-0"
            >
              <ResponsiveContainer width="100%" height={320}>
                {activeChartStyle === 'LINE' ? (
                  <LineChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
                    <XAxis dataKey="period" tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }} />
                    <YAxis
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                      tickFormatter={(value) => formatCompactCost(Number(value), unit)}
                    />
                    <Tooltip content={<CostGraphTooltip unit={unit} />} />
                    {visibleBaseSeries.map((series, index) => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        name={series.label}
                        stroke={series.color}
                        strokeWidth={2}
                        strokeDasharray={index % 3 === 1 ? '6 4' : undefined}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    ))}
                    {forecastVisible ? (
                      <Line
                        type="monotone"
                        dataKey="forecast"
                        name="Forecast"
                        stroke={CHART_COLORS.warning}
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    ) : null}
                  </LineChart>
                ) : (
                  <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
                    <XAxis dataKey="period" tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }} />
                    <YAxis
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                      tickFormatter={(value) => formatCompactCost(Number(value), unit)}
                    />
                    <Tooltip content={<CostGraphTooltip unit={unit} />} />
                    {visibleBaseSeries.map((series) => (
                      <Bar
                        key={series.key}
                        dataKey={series.key}
                        name={series.label}
                        fill={series.color}
                        stackId={activeChartStyle === 'STACK' ? 'cost' : undefined}
                        radius={activeChartStyle === 'STACK' ? 0 : [4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                    ))}
                    {forecastVisible ? (
                      <Line
                        type="monotone"
                        dataKey="forecast"
                        name="Forecast"
                        stroke={CHART_COLORS.warning}
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    ) : null}
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
            <p className="sr-only">
              {graphSeries
                .map((series, index) => {
                  const total =
                    comparisonMetric && series.key === 'baseline'
                      ? comparisonMetric.baseline
                      : comparisonMetric && series.key === 'comparison'
                        ? comparisonMetric.comparison
                        : series.key === 'forecast'
                      ? forecast?.total
                      : result?.series[index]?.total;
                  return total
                    ? `${series.label}: ${formatCostValue(total, unit)}`
                    : series.label;
                })
                .join('. ')}
            </p>
            <div aria-label="Chart legend" className="flex flex-wrap gap-2">
              {graphSeries.map((series) => {
                const visible = !hiddenSeries.has(series.key);
                return (
                  <button
                    key={series.key}
                    type="button"
                    aria-pressed={visible}
                    aria-label={`${visible ? 'Hide' : 'Show'} ${series.label} series`}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                      visible
                        ? 'border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300'
                        : 'border-gray-100 text-gray-400 opacity-60 dark:border-gray-800 dark:text-gray-500',
                    )}
                    onClick={() => toggleSeries(series.key)}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: series.color }}
                    />
                    {series.label}
                  </button>
                );
              })}
            </div>
            {request.showForecast && !forecast ? (
              <p className="text-sm font-medium text-warning-700 dark:text-warning-400">
                Forecast unavailable
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
