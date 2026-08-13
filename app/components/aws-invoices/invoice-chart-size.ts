/**
 * Chart heights for the invoice service panels.
 *
 * Both panels used a fixed 300px container. Recharts positions a horizontal
 * legend absolutely at the bottom of that container without shrinking a pie, so
 * a real invoice's 17 services wrapped into enough legend rows to sit on top of
 * the donut. Sizing from the item count keeps the plot band and the legend in
 * separate space.
 */

/** Height of the donut's own plot band, above the legend. */
export const PIE_PLOT_HEIGHT = 300;

/** The legend wraps to roughly two columns at the panel's half-grid width. */
const LEGEND_COLUMNS = 2;
const LEGEND_ROW_HEIGHT = 22;
const LEGEND_MAX_ROWS = 9;

export function servicePieLegendHeight(itemCount: number): number {
  const rows = Math.ceil(Math.max(itemCount, 0) / LEGEND_COLUMNS);
  return Math.min(rows, LEGEND_MAX_ROWS) * LEGEND_ROW_HEIGHT;
}

export function servicePieHeight(itemCount: number): number {
  return PIE_PLOT_HEIGHT + servicePieLegendHeight(itemCount);
}

/** Vertical room per bar, enough for the 11px category label plus padding. */
const BAR_BAND_HEIGHT = 34;
/** Axis and margin overhead outside the plotted bands. */
const BAR_CHART_CHROME = 48;
const CHART_MIN_HEIGHT = 300;

export function topServicesHeight(itemCount: number): number {
  return Math.max(
    CHART_MIN_HEIGHT,
    Math.max(itemCount, 0) * BAR_BAND_HEIGHT + BAR_CHART_CHROME,
  );
}
