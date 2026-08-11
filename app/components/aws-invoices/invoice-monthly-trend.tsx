'use client';

import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartTooltip } from '@/app/components/chart-tooltip';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chart-colors';
import { InvoiceChartCard } from './invoice-chart-card';
import { formatInvoiceMoney } from './invoice-format';

export function InvoiceMonthlyTrend({ dashboard }: { dashboard: AwsInvoiceDashboard }) {
  const data = [...dashboard.monthlyTrend].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const format = (value: number) => formatInvoiceMoney(value, dashboard.selected.currency);
  return (
    <InvoiceChartCard title="Monthly invoice trend" description="Amount due across available months" ariaLabel="Monthly invoice trend line chart" empty={data.length === 0} summary={<ul>{data.map((item) => <li key={item.yearMonth}>{item.yearMonth}: {format(item.value)}</li>)}</ul>}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
          <XAxis dataKey="yearMonth" tick={{ fontSize: 11, fill: CHART_AXIS_COLOR }} />
          <YAxis hide />
          <Tooltip content={<ChartTooltip format={format} />} />
          <Line type="monotone" dataKey="value" stroke={CHART_COLORS.brand} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </InvoiceChartCard>
  );
}
