'use client';

import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { ChartTooltip } from '@/app/components/chart-tooltip';
import { CHART_COLORS } from '@/lib/chart-colors';
import { InvoiceChartCard } from './invoice-chart-card';
import { formatInvoiceMoney } from './invoice-format';
import {
  PIE_PLOT_HEIGHT,
  servicePieHeight,
  servicePieLegendHeight,
} from './invoice-chart-size';

const COLORS = [
  CHART_COLORS.brand,
  CHART_COLORS.blueLight,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.purple,
  CHART_COLORS.pink,
];

export function InvoiceServicePie({ dashboard }: { dashboard: AwsInvoiceDashboard }) {
  const data = [...dashboard.serviceBreakdown].sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name),
  );
  const format = (value: number) =>
    formatInvoiceMoney(value, dashboard.selected.currency);

  return (
    <InvoiceChartCard
      title="Service breakdown"
      description="Share of billed service totals"
      ariaLabel="Service breakdown donut chart"
      empty={data.length === 0}
      summary={
        <ul>{data.map((item) => <li key={item.name}>{item.name}: {format(item.value)} ({item.percentage.toFixed(2)}%)</li>)}</ul>
      }
    >
      <ResponsiveContainer width="100%" height={servicePieHeight(data.length)}>
        <PieChart>
          {/* Anchor the donut in the top plot band so the legend below it can
              never overlap the slices, however many services there are. */}
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cy={PIE_PLOT_HEIGHT / 2}
            innerRadius={58}
            outerRadius={88}
          >
            {data.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          <Tooltip content={<ChartTooltip format={format} />} />
          <Legend
            iconType="circle"
            verticalAlign="bottom"
            height={servicePieLegendHeight(data.length)}
            wrapperStyle={{ fontSize: 12, lineHeight: '22px', overflowY: 'auto' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </InvoiceChartCard>
  );
}
