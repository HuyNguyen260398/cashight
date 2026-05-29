/**
 * Shared formatting utilities for the expense-tracker dashboard.
 * Pure module — no React, no side effects.
 */

const vndFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

/**
 * Format a number as a Vietnamese Dong currency string.
 * Example: 26986712 → "26.986.712 ₫"
 */
export function formatVND(n: number): string {
  return vndFormatter.format(n);
}
