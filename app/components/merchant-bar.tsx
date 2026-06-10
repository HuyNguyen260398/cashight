'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatVND, formatVNDCompact } from '@/lib/format';

export function MerchantBar({
  data,
}: {
  data: Array<{ merchant: string; value: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data} layout="vertical" margin={{ left: 16, right: 16 }}>
        <XAxis
          type="number"
          tickFormatter={(v) => formatVNDCompact(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="merchant"
          width={160}
          interval={0}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: string) =>
            v.length > 18 ? `${v.slice(0, 17)}…` : v
          }
        />
        <Tooltip formatter={(v) => formatVND(Number(v))} />
        <defs>
          <linearGradient id="merchantGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <Bar dataKey="value" fill="url(#merchantGradient)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
