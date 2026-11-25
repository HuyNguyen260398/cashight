'use client';

import { CartesianChart } from '@cloudscape-design/chart-components';
import { formatVND, formatVNDCompact } from '@/lib/format';
import { merchantBarSeries } from '@/app/components/charts/merchant-series';
import { ChartEmpty, ChartLoading } from '@/app/components/charts/chart-states';
import { useHighcharts } from '@/app/components/charts/use-highcharts';

const HEIGHT = 350;

export function MerchantBar({ data }: { data: Array<{ merchant: string; value: number; category?: string }> }) {
  const highcharts = useHighcharts();
  const { categories, series } = merchantBarSeries(data);
  if (!highcharts) return <ChartLoading height={HEIGHT} />;
  if (series.length === 0) return <ChartEmpty height={HEIGHT} />;
  return (
    <CartesianChart
      highcharts={highcharts}
      chartHeight={HEIGHT}
      ariaLabel="Top merchants"
      inverted
      stacking="normal"
      series={series}
      xAxis={{ type: 'category', title: 'Merchant', categories }}
      yAxis={{ title: 'Spend', valueFormatter: (v) => formatVNDCompact(v ?? 0) }}
      tooltip={{ point: ({ item }) => ({ key: item.series.name, value: formatVND(item.y ?? 0) }) }}
    />
  );
}
