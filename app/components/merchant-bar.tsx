'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chart-colors';
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
          tick={{ fontSize: 12, fill: CHART_AXIS_COLOR }}
          tickFormatter={(v) => formatVNDCompact(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="merchant"
          width={160}
          interval={0}
          tick={{ fontSize: 11, fill: CHART_AXIS_COLOR }}
          tickFormatter={(v) => {
            const label = String(v);
            return label.length > 18 ? `${label.slice(0, 17)}…` : label;
          }}
        />
        <Tooltip formatter={(v) => formatVND(Number(v))} />
        <defs>
          <linearGradient id="merchantGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={CHART_COLORS.brand} />
            <stop offset="100%" stopColor={CHART_COLORS.brandLight} />
          </linearGradient>
        </defs>
        <Bar dataKey="value" fill="url(#merchantGradient)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
