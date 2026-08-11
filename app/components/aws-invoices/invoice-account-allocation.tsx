'use client';

import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartTooltip } from '@/app/components/chart-tooltip';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chart-colors';
import { InvoiceChartCard } from './invoice-chart-card';
import { formatInvoiceMoney } from './invoice-format';

export function InvoiceAccountAllocation({ dashboard }: { dashboard: AwsInvoiceDashboard }) {
  const data = [...dashboard.accountAllocations]
    .sort((a, b) => b.value - a.value || a.accountLast4.localeCompare(b.accountLast4))
    .map((item) => ({ ...item, account: `•••• ${item.accountLast4}` }));
  const format = (value: number) => formatInvoiceMoney(value, dashboard.selected.currency);
  return (
    <InvoiceChartCard title="Linked account allocation" description="Billed totals by masked account" ariaLabel="Linked account allocation chart" empty={data.length === 0} summary={<ul>{data.map((item) => <li key={item.accountLast4}>{item.account}: {format(item.value)}</li>)}</ul>}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="account" width={90} tick={{ fontSize: 11, fill: CHART_AXIS_COLOR }} />
          <Tooltip content={<ChartTooltip format={format} />} />
          <Bar dataKey="value" fill={CHART_COLORS.success} radius={[0, 5, 5, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </InvoiceChartCard>
  );
}
