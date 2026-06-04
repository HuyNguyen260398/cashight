'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import type { AggregatedView } from '@/lib/aggregations';
import { formatVND, formatVNDCompact } from '@/lib/format';

export function InstallmentAreaChart({ view }: { view: AggregatedView }) {
  // Per-sub-period installments — monthly buckets for year/quarter views, daily
  // for the month view. Reads view.installmentSubPeriods directly; the buckets
  // mirror the spend subPeriods so this lines up with the Spending trend chart.

  // Numeric height (not "100%") so calculatedHeight is positive on first render
  // — before ResponsiveContainer's ResizeObserver reports a size — avoiding
  // recharts' "width(-1) and height(-1)" warning. Matches TrendChart.
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart
        data={view.installmentSubPeriods}
        margin={{ top: 8, right: 8, left: 0, bottom: 24 }}
      >
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12 }}
          interval={0}
          angle={-45}
          textAnchor="end"
          height={48}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v) => formatVNDCompact(Number(v))}
        />
        <Tooltip formatter={(v) => formatVND(Number(v))} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
