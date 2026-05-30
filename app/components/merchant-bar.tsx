'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatVND } from '@/lib/format';

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
          tickFormatter={(v) => `${Math.round(v / 1_000_000)}M`}
        />
        <YAxis
          type="category"
          dataKey="merchant"
          width={140}
          tick={{ fontSize: 12 }}
        />
        <Tooltip formatter={(v) => formatVND(Number(v))} />
        <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
