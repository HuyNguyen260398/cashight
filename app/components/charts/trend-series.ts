import type { CartesianChartProps } from '@cloudscape-design/chart-components';
import type { AggregatedView } from '@/lib/aggregations';

type Buckets = ReadonlyArray<{ label: string; value: number }>;

function bucketSeries<T extends CartesianChartProps.SeriesOptions>(buckets: Buckets, build: (data: number[]) => T) {
  return {
    categories: buckets.map((b) => b.label),
    series: buckets.length === 0 ? [] : [build(buckets.map((b) => b.value))],
  };
}

export function trendSeries(view: AggregatedView) {
  return bucketSeries(view.subPeriods, (data): CartesianChartProps.ColumnSeriesOptions => ({ type: 'column', name: 'Spending', data }));
}

export function installmentSeries(view: AggregatedView) {
  return bucketSeries(view.installmentSubPeriods, (data): CartesianChartProps.AreaSeriesOptions => ({ type: 'area', name: 'Installments', data }));
}
