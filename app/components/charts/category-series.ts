import type { PieChartProps } from '@cloudscape-design/chart-components';
import { categoryColor } from '@/lib/category-colors';

export function categoryPieSeries(
  data: ReadonlyArray<{ category: string; value: number }>,
): PieChartProps.DonutSeriesOptions | null {
  if (data.length === 0) return null;
  return {
    type: 'donut',
    name: 'Spending by category',
    data: data.map(({ category, value }) => ({ id: category, name: category, y: value, color: categoryColor(category) })),
  };
}
