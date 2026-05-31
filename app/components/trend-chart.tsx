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
  return (
    <div className="w-full h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={view.subPeriods}
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
          <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
