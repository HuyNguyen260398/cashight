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
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chart-colors';
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
        margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
      >
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: CHART_AXIS_COLOR }}
          interval="preserveStartEnd"
          textAnchor="middle"
          height={28}
        />
        <YAxis
          tick={{ fontSize: 12, fill: CHART_AXIS_COLOR }}
          tickFormatter={(v) => formatVNDCompact(Number(v))}
        />
        <Tooltip formatter={(v) => formatVND(Number(v))} />
        <defs>
          <linearGradient id="installmentGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.brand} stopOpacity={0.55} />
            <stop offset="100%" stopColor={CHART_COLORS.brandLight} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={CHART_COLORS.brand}
          fill="url(#installmentGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
