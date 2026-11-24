'use client';

import { PieChart } from '@cloudscape-design/chart-components';
import { formatVND } from '@/lib/format';
import { categoryPieSeries } from '@/app/components/charts/category-series';
import { ChartEmpty, ChartLoading } from '@/app/components/charts/chart-states';
import { useHighcharts } from '@/app/components/charts/use-highcharts';

const HEIGHT = 320;

export function CategoryPie({ data }: { data: Array<{ category: string; value: number }> }) {
  const highcharts = useHighcharts();
  const series = categoryPieSeries(data);
  if (!highcharts) return <ChartLoading height={HEIGHT} />;
  if (!series) return <ChartEmpty height={HEIGHT} />;
  return (
    <PieChart
      highcharts={highcharts}
      chartHeight={HEIGHT}
      ariaLabel="Spending by category"
      series={series}
      segmentDescription={({ segmentValue, totalValue }) =>
        `${formatVND(segmentValue)} · ${((segmentValue / totalValue) * 100).toFixed(0)}%`
      }
      tooltip={{
        details: ({ segmentValue, totalValue }) => [
          { key: 'Spend', value: formatVND(segmentValue) },
          { key: 'Share', value: `${((segmentValue / totalValue) * 100).toFixed(1)}%` },
        ],
      }}
    />
  );
}
