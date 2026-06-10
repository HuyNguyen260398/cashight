'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import type { AggregatedView } from '@/lib/aggregations';
import { formatVND, formatVNDCompact } from '@/lib/format';

export function TrendChart({ view }: { view: AggregatedView }) {
  // Use a numeric height (not height="100%") so calculatedHeight is positive on
  // the first render — before ResponsiveContainer's ResizeObserver reports a
  // size — which avoids recharts' "width(-1) and height(-1)" warning. This
  // matches the fixed-height pattern used by the category/merchant charts.
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={view.subPeriods}
        margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
      >
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          interval="preserveStartEnd"
          textAnchor="middle"
          height={28}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v) => formatVNDCompact(Number(v))}
        />
        <Tooltip formatter={(v) => formatVND(Number(v))} />
        <defs>
          <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <Bar dataKey="value" fill="url(#trendGradient)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
