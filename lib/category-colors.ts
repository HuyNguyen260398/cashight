import { CHART_COLORS } from '@/lib/chart-colors';

/**
 * Category color palette for the expense-tracker dashboard.
 *
 * Single source of truth imported by the pie/donut chart and transaction-table
 * badges. Plain data module — no React, no Tailwind.
 */

export const CATEGORY_COLORS: Record<string, string> = {
  'E-commerce': CHART_COLORS.brand,
  'Food & Dining': CHART_COLORS.orange,
  'Groceries': CHART_COLORS.success,
  'Shopping': CHART_COLORS.pink,
  'Software & Subscriptions': CHART_COLORS.blueLight,
  'Entertainment': CHART_COLORS.purple,
  'Travel': CHART_COLORS.brandLight,
  'Installments': CHART_COLORS.warning,
  'Cashback': CHART_COLORS.successDark,
  'Fees & Interest': CHART_COLORS.error,
  'Payment': CHART_COLORS.gray,
  'Other': CHART_COLORS.errorDark,
};

/** Fallback for any unknown category not in the table. */
const FALLBACK_COLOR = CHART_COLORS.gray;

/**
 * Return the hex color for a given category.
 * Falls back to a neutral gray for any category not in CATEGORY_COLORS.
 */
export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? FALLBACK_COLOR;
}
