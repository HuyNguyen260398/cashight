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

/**
 * Format a non-negative number as a compact Vietnamese Dong string for chart
 * axis ticks. Negative values fall through to the raw-number branch and are
 * not handled gracefully — this function is intentionally designed for
 * non-negative spend magnitudes only.
 *
 * Examples: 26986712 → "27.0M ₫", 500000 → "500K ₫", 999 → "999 ₫"
 */
export function formatVNDCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ₫`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K ₫`;
  return `${value} ₫`;
}

/**
 * Format an ISO date string using the Vietnamese locale medium date style.
 * Example: "2026-05-15" → "15 thg 5, 2026"
 */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(iso));
}
