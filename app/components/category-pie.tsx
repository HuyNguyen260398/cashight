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
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="category"
          innerRadius={60}
          outerRadius={100}
        >
          {data.map((d) => (
            <Cell key={d.category} fill={categoryColor(d.category)} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => formatVND(Number(v))} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
