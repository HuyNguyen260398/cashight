'use client';

import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartTooltip } from '@/app/components/chart-tooltip';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chart-colors';
import { InvoiceChartCard } from './invoice-chart-card';
import { topServicesHeight } from './invoice-chart-size';
import { formatInvoiceMoney } from './invoice-format';

export function InvoiceTopServices({ dashboard }: { dashboard: AwsInvoiceDashboard }) {
  const data = [...dashboard.topServices].sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name),
  );
  const format = (value: number) => formatInvoiceMoney(value, dashboard.selected.currency);

  return (
    <InvoiceChartCard title="Top services" description="Largest billed services" ariaLabel="Top services bar chart" empty={data.length === 0} summary={<ul>{data.map((item) => <li key={item.name}>{item.name}: {format(item.value)}</li>)}</ul>}>
      <ResponsiveContainer width="100%" height={topServicesHeight(data.length)}>
        <BarChart data={data} layout="vertical" margin={{ left: 12, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.2} />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: CHART_AXIS_COLOR }} tickFormatter={(value) => String(value).length > 24 ? `${String(value).slice(0, 23)}…` : String(value)} />
          <Tooltip content={<ChartTooltip format={format} />} />
          <Bar dataKey="value" fill={CHART_COLORS.brand} radius={[0, 5, 5, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </InvoiceChartCard>
  );
}
