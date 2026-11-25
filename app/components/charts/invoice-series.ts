import type { CartesianChartProps } from '@cloudscape-design/chart-components';
import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';

export function invoiceMonthlyTrendSeries(dashboard: AwsInvoiceDashboard): {
  categories: string[];
  series: CartesianChartProps.LineSeriesOptions[];
} {
  const months = [...dashboard.monthlyTrend].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  return {
    categories: months.map((m) => m.yearMonth),
    series: months.length ? [{ type: 'line', name: 'Amount due', data: months.map((m) => m.value) }] : [],
  };
}
