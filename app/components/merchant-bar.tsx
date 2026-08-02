'use client';

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { CHART_AXIS_COLOR, gradientPair } from '@/lib/chart-colors';
import { categoryColor } from '@/lib/category-colors';
import { formatVNDCompact } from '@/lib/format';
import { ChartTooltip } from '@/app/components/chart-tooltip';

export function MerchantBar({
  data,
}: {
  data: Array<{ merchant: string; value: number; category?: string }>;
}) {
  // Each bar takes its category's colour, so a merchant here matches its slice
  // in the category pie. Gradient ids are per-index and prefixed, since <defs>
  // ids are global to the document and this chart shares a page with others.
  const gradients = data.map((d) => gradientPair(categoryColor(d.category ?? '')));

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
        {/* Name the category in the tooltip — otherwise the colours are the
            only clue to what they mean, which fails for colour-blind users. */}
        <Tooltip
          cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
          content={
            <ChartTooltip
              titleOf={(item) => String(item.payload?.merchant ?? '')}
              colorOf={(item) =>
                categoryColor(String(item.payload?.category ?? ''))
              }
              captionOf={(item) =>
                (item.payload?.category as string | undefined) ?? undefined
              }
            />
          }
        />
        <defs>
          {gradients.map((stop, index) => (
            <linearGradient
              key={index}
              id={`merchantGradient-${index}`}
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" stopColor={stop.from} />
              <stop offset="100%" stopColor={stop.to} />
            </linearGradient>
          ))}
        </defs>
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, index) => (
            <Cell key={d.merchant} fill={`url(#merchantGradient-${index})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
