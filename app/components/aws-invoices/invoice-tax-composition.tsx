'use client';

import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartTooltip } from '@/app/components/chart-tooltip';
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_CURSOR_FILL } from '@/lib/chart-colors';
import { InvoiceChartCard } from './invoice-chart-card';
import { formatInvoiceMoney } from './invoice-format';

export function InvoiceTaxComposition({ dashboard }: { dashboard: AwsInvoiceDashboard }) {
  const data = dashboard.chargeComposition;
  const format = (value: number) => formatInvoiceMoney(value, dashboard.selected.currency);
  return (
    <InvoiceChartCard title="Charge and tax composition" description="Charges, applied credits, and tax" ariaLabel="Charge and tax composition chart" empty={data.every((item) => item.value === 0)} summary={<ul>{data.map((item) => <li key={item.name}>{item.name}: {format(item.value)}</li>)}</ul>}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ left: 4, right: 4 }}>
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: CHART_AXIS_COLOR }} />
          <YAxis hide />
          <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: CHART_CURSOR_FILL }} />
          <Bar dataKey="value" fill={CHART_COLORS.warning} radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </InvoiceChartCard>
  );
}
