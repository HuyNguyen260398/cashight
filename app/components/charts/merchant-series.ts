import type { CartesianChartProps } from '@cloudscape-design/chart-components';
import { categoryColor } from '@/lib/category-colors';

const UNCATEGORISED = 'Other';

/**
 * Cartesian points can't be coloured individually, so each spending category
 * becomes its own column series (null for merchants outside it). Stacked, the
 * chart shows one bar per merchant in its category's colour, matching the
 * category donut, with a legend naming the categories.
 */
export function merchantBarSeries(
  data: ReadonlyArray<{ merchant: string; value: number; category?: string }>,
): { categories: string[]; series: CartesianChartProps.ColumnSeriesOptions[] } {
  const groups = new Map<string, { color: string; data: (number | null)[] }>();
  data.forEach(({ value, category }, index) => {
    const name = category || UNCATEGORISED;
    if (!groups.has(name)) groups.set(name, { color: categoryColor(category ?? ''), data: data.map(() => null) });
    groups.get(name)!.data[index] = value;
  });
  return {
    categories: data.map((d) => d.merchant),
    series: [...groups].map(([name, group]) => ({ type: 'column', name, color: group.color, data: group.data })),
  };
}
