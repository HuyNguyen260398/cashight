'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatVND } from '@/lib/format';

export function DailySpendLine({
  data,
}: {
  data: Array<{ date: string; cumulative: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => d.slice(5)}
          tick={{ fontSize: 12 }}
        />
        <YAxis tickFormatter={(v) => `${Math.round(v / 1_000_000)}M`} />
        <Tooltip
          formatter={(v) => formatVND(Number(v))}
          labelFormatter={(l) => `Date: ${l}`}
        />
        <Area
          type="monotone"
          dataKey="cumulative"
          stroke="#6366f1"
          fill="#6366f1"
          fillOpacity={0.2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
