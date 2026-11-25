'use client';

import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';
import { CartesianChart } from '@cloudscape-design/chart-components';

import { ChartLoading } from '@/app/components/charts/chart-states';
import { invoiceMonthlyTrendSeries } from '@/app/components/charts/invoice-series';
import { useHighcharts } from '@/app/components/charts/use-highcharts';
import { InvoiceChartCard } from './invoice-chart-card';
import { formatInvoiceMoney } from './invoice-format';

const HEIGHT = 300;

export function InvoiceMonthlyTrend({ dashboard }: { dashboard: AwsInvoiceDashboard }) {
  const highcharts = useHighcharts();
  const { categories, series } = invoiceMonthlyTrendSeries(dashboard);
  const format = (value: number) => formatInvoiceMoney(value, dashboard.selected.currency);
  return (
    <InvoiceChartCard
      title="Monthly invoice trend"
      description="Amount due across available months"
      ariaLabel="Monthly invoice trend line chart"
      empty={series.length === 0}
      summary={
        <ul>
          {categories.map((month, index) => (
            <li key={month}>
              {month}: {format(series[0]!.data[index] as number)}
            </li>
          ))}
        </ul>
      }
    >
      {highcharts ? (
        <CartesianChart
          highcharts={highcharts}
          chartHeight={HEIGHT}
          ariaLabel="Monthly invoice trend"
          legend={{ enabled: false }}
          series={series}
          xAxis={{ type: 'category', title: 'Month', categories }}
          yAxis={{ title: 'Amount due', valueFormatter: (v) => format(v ?? 0) }}
          tooltip={{ point: ({ item }) => ({ key: item.series.name, value: format(item.y ?? 0) }) }}
        />
      ) : (
        <ChartLoading height={HEIGHT} />
      )}
    </InvoiceChartCard>
  );
}
