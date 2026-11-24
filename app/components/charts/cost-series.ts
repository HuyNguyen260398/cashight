import type { CartesianChartProps } from '@cloudscape-design/chart-components';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import type {
  CostExplorerComparison,
  CostExplorerCompleteResult,
  CostExplorerForecast,
} from '@/frontend/api/contracts';
import {
  decimalNumber,
  displayGroupValues,
  displayGroupedLabel,
  formatPeriodLabel,
} from '@/app/components/aws-cost-explorer/cost-format';

export type ChartStyle = CostExplorerReportRequest['chartStyle'];

type Series = CartesianChartProps.ColumnSeriesOptions | CartesianChartProps.LineSeriesOptions;

export interface CostUsageSeries {
  categories: string[];
  series: Series[];
  stacking?: 'normal';
  ariaLabel: string;
}

export function chartName(style: ChartStyle): string {
  if (style === 'STACK') return 'Stacked bar chart';
  if (style === 'LINE') return 'Line chart';
  return 'Bar chart';
}

/** Stable, opaque id per AWS series key (labels can repeat across groups). */
export function seriesId(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `series-${(hash >>> 0).toString(36)}`;
}

/**
 * Turns a Cost Explorer report into chart-components series. Bars group or
 * stack by style; lines alternate a dashed stroke every third series so they
 * stay distinguishable without colour. A forecast extends the x axis and is
 * always a dashed line.
 */
export function costUsageSeries({
  request,
  result,
  forecast,
  comparison,
  chartStyle,
}: {
  request: CostExplorerReportRequest;
  result: CostExplorerCompleteResult | null;
  forecast: CostExplorerForecast | null;
  comparison: CostExplorerComparison | null;
  chartStyle: ChartStyle;
}): CostUsageSeries {
  const line = chartStyle === 'LINE';
  const stacking = chartStyle === 'STACK' ? ('normal' as const) : undefined;
  const label = (count: number, unit: string) =>
    `${chartName(chartStyle)} of ${request.metric} across ${count} ${count === 1 ? unit : `${unit}s`}`;
  const base = (id: string, name: string, data: (number | null)[], index: number): Series =>
    line
      ? { type: 'line', id, name, data, ...(index % 3 === 1 ? { dashStyle: 'Dash' as const } : {}) }
      : { type: 'column', id, name, data };

  if (comparison) {
    const metric = Object.keys(comparison.total)[0];
    const rows = metric ? comparison.comparisons : [];
    const pick = (key: 'baseline' | 'comparison') => rows.map((row) => decimalNumber(row.metrics[metric!]?.[key]));
    return {
      categories: rows.map((row) => displayGroupValues(row.groupValues, request.groupBy) || 'Total'),
      series: rows.length ? [base('baseline', 'Baseline', pick('baseline'), 0), base('comparison', 'Comparison', pick('comparison'), 2)] : [],
      stacking: undefined,
      ariaLabel: label(rows.length, 'group'),
    };
  }

  const periods = result?.periods ?? [];
  const forecastPeriods = forecast?.periods ?? [];
  const categories = [...periods, ...forecastPeriods].map((p) => formatPeriodLabel(p.start, request.granularity));
  const padForecast = forecastPeriods.map(() => null);
  const series: Series[] =
    periods.length === 0
      ? []
      : (result?.series ?? []).map((s, index) =>
          base(
            seriesId(s.key),
            displayGroupedLabel(s.label, request.groupBy),
            [...periods.map((_, i) => decimalNumber(s.values[i])), ...padForecast],
            index,
          ),
        );
  if (forecast && forecastPeriods.length) {
    series.push({
      type: 'line',
      id: 'forecast',
      name: 'Forecast',
      dashStyle: 'Dash',
      data: [...periods.map(() => null), ...forecastPeriods.map((p) => decimalNumber(p.mean))],
    });
  }
  return { categories, series, stacking: line ? undefined : stacking, ariaLabel: label(categories.length, 'period') };
}
