/**
 * 16×16 chart-type glyphs for the chart style toggle. Cloudscape ships only a
 * plain `bar-chart` icon — nothing for stacked bars or lines — so all three
 * are drawn here in the same style. Pass via `iconSvg`.
 *
 * Cloudscape's icon CSS forces `stroke: currentColor` and its own stroke width
 * on every shape, so (like its built-in icons) solid shapes use the
 * `filled no-stroke` classes and lines rely on the injected 2px stroke.
 */

const svgProps = {
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  focusable: false,
  'aria-hidden': true,
} as const;

const SOLID = 'filled no-stroke';

function Baseline() {
  return <rect className={SOLID} x="0" y="14.5" width="16" height="1.5" />;
}

/** Three side-by-side bars of different heights on a baseline. */
export function BarChartIcon() {
  return (
    <svg {...svgProps}>
      <rect className={SOLID} x="1" y="8" width="3.5" height="5.5" />
      <rect className={SOLID} x="6.25" y="2" width="3.5" height="11.5" />
      <rect className={SOLID} x="11.5" y="5" width="3.5" height="8.5" />
      <Baseline />
    </svg>
  );
}

/** The same bars, each split into two stacked segments by a gap. */
export function StackedBarChartIcon() {
  return (
    <svg {...svgProps}>
      <rect className={SOLID} x="1" y="10.5" width="3.5" height="3" />
      <rect className={SOLID} x="1" y="6" width="3.5" height="3" />
      <rect className={SOLID} x="6.25" y="8" width="3.5" height="5.5" />
      <rect className={SOLID} x="6.25" y="2" width="3.5" height="4.5" />
      <rect className={SOLID} x="11.5" y="9.5" width="3.5" height="4" />
      <rect className={SOLID} x="11.5" y="4" width="3.5" height="4" />
      <Baseline />
    </svg>
  );
}

/** A rising polyline on a baseline. */
export function LineChartIcon() {
  return (
    <svg {...svgProps}>
      <polyline className="stroke-linejoin-round stroke-linecap-round" points="2,11 6,6.5 9.5,8.5 14,3" />
      <Baseline />
    </svg>
  );
}
