'use client';

import { CartesianChart } from '@cloudscape-design/chart-components';
import type { AggregatedView } from '@/lib/aggregations';
import { formatVND, formatVNDCompact } from '@/lib/format';
import { trendSeries } from '@/app/components/charts/trend-series';
import { CHART_HEIGHT, ChartEmpty, ChartLoading } from '@/app/components/charts/chart-states';
import { useHighcharts } from '@/app/components/charts/use-highcharts';

export function TrendChart({ view }: { view: AggregatedView }) {
  const highcharts = useHighcharts();
  const { categories, series } = trendSeries(view);
  if (!highcharts) return <ChartLoading />;
  if (series.length === 0) return <ChartEmpty />;
  return (
    <CartesianChart
      highcharts={highcharts}
      chartHeight={CHART_HEIGHT}
      ariaLabel="Spending trend"
      legend={{ enabled: false }}
      series={series}
      xAxis={{ type: 'category', title: 'Period', categories }}
      yAxis={{ title: 'Spend', valueFormatter: (v) => formatVNDCompact(v ?? 0) }}
      tooltip={{ point: ({ item }) => ({ key: item.series.name, value: formatVND(item.y ?? 0) }) }}
    />
  );
}
