/**
 * Category color palette for the expense-tracker dashboard.
 *
 * Single source of truth imported by the pie/donut chart and transaction-table
 * badges. Plain data module — no React, no Tailwind.
 */

export const CATEGORY_COLORS: Record<string, string> = {
  'E-commerce': '#6366f1',           // indigo
  'Food & Dining': '#f97316',        // orange
  'Groceries': '#22c55e',            // green
  'Shopping': '#ec4899',             // pink
  'Software & Subscriptions': '#3b82f6', // blue
  'Entertainment': '#a855f7',        // purple
  'Travel': '#14b8a6',               // teal
  'Installments': '#f59e0b',         // amber
  'Cashback': '#10b981',             // emerald
  'Fees & Interest': '#ef4444',      // red
  'Payment': '#64748b',              // slate
  'Other': '#8b5cf6',                // violet
};

/** Fallback for any unknown category not in the table. */
const FALLBACK_COLOR = '#94a3b8'; // neutral gray (slate-400)

/**
 * Return the hex color for a given category.
 * Falls back to a neutral gray for any category not in CATEGORY_COLORS.
 */
export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? FALLBACK_COLOR;
}
