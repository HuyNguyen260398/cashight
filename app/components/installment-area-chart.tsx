'use client';

import { CartesianChart } from '@cloudscape-design/chart-components';
import type { AggregatedView } from '@/lib/aggregations';
import { formatVND, formatVNDCompact } from '@/lib/format';
import { installmentSeries } from '@/app/components/charts/trend-series';
import { CHART_HEIGHT, ChartEmpty, ChartLoading } from '@/app/components/charts/chart-states';
import { useHighcharts } from '@/app/components/charts/use-highcharts';

/**
 * Per-sub-period installments — monthly buckets for year/quarter views, daily
 * for the month view. The buckets mirror the spend subPeriods so this lines up
 * with the Spending trend chart.
 */
export function InstallmentAreaChart({ view }: { view: AggregatedView }) {
  const highcharts = useHighcharts();
  const { categories, series } = installmentSeries(view);
  if (!highcharts) return <ChartLoading />;
  if (series.length === 0) return <ChartEmpty>No installments in this period</ChartEmpty>;
  return (
    <CartesianChart
      highcharts={highcharts}
      chartHeight={CHART_HEIGHT}
      ariaLabel="Installments"
      legend={{ enabled: false }}
      series={series}
      xAxis={{ type: 'category', title: 'Period', categories }}
      yAxis={{ title: 'Installments', valueFormatter: (v) => formatVNDCompact(v ?? 0) }}
      tooltip={{ point: ({ item }) => ({ key: item.series.name, value: formatVND(item.y ?? 0) }) }}
    />
  );
}
