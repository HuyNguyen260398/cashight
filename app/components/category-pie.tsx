'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { categoryColor } from '@/lib/category-colors';
import { formatVND } from '@/lib/format';

export function CategoryPie({
  data,
}: {
  data: Array<{ category: string; value: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="category"
          cx="50%"
          cy="45%"
          innerRadius={55}
          outerRadius={85}
        >
          {data.map((d) => (
            <Cell key={d.category} fill={categoryColor(d.category)} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => formatVND(Number(v))} />
        <Legend
          verticalAlign="bottom"
          height={40}
          iconType="circle"
          wrapperStyle={{ fontSize: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
