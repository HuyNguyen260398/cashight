'use client';

import type { ReactElement } from 'react';
import { CHART_COLORS } from '@/lib/chart-colors';
import { formatVND } from '@/lib/format';

/**
 * Shared hover panel for every dashboard chart.
 *
 * Replaces recharts' default tooltip, which renders a square high-contrast box
 * sized to the widest row rather than to its content. This one shrinks to fit
 * (`w-fit` + `whitespace-nowrap`), rounds to match the surrounding cards, and
 * tints the value with the colour of whatever is being hovered — so the number
 * is visibly tied to the bar, slice, or area it came from.
 *
 * The colour has to be passed in per chart: a bar filled with
 * `url(#merchantGradient-3)` reports that string as its fill, which is not a
 * usable text colour. `colorOf` lets each chart resolve the real hex.
 */

/** The shape recharts hands to a custom tooltip for each hovered series. */
export interface TooltipItem {
  name?: string | number;
  value?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  // Injected by recharts when it clones the element passed to `content`.
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;

  /** Heading above the value. Defaults to the axis label or the series name. */
  titleOf?: (item: TooltipItem, label?: string | number) => string;
  /** Resolves the value's text colour. Defaults to the series colour. */
  colorOf?: (item: TooltipItem) => string;
  /** Optional muted line under the value, e.g. a merchant's category. */
  captionOf?: (item: TooltipItem) => string | undefined;
  /** Defaults to VND. */
  format?: (value: number) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  titleOf,
  colorOf,
  captionOf,
  format = formatVND,
}: ChartTooltipProps): ReactElement | null {
  if (!active || !payload?.length) return null;

  const item = payload[0];
  const title = titleOf
    ? titleOf(item, label)
    : String(label ?? item.name ?? '');
  const color = colorOf?.(item) ?? item.color ?? CHART_COLORS.brand;
  const caption = captionOf?.(item);

  return (
    <div className="w-fit whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-theme-md dark:border-gray-700 dark:bg-gray-900">
      {title && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{title}</p>
      )}
      <p
        className="mt-0.5 text-sm font-semibold tabular-nums"
        style={{ color }}
      >
        {format(Number(item.value ?? 0))}
      </p>
      {caption && (
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
          {caption}
        </p>
      )}
    </div>
  );
}
