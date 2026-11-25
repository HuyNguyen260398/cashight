// jsdom shims needed by Cloudscape / Highcharts in component tests.
if (typeof window !== 'undefined') {
  // Highcharts calls CSS.supports() at import; jsdom (or a CSS.escape
  // polyfill pulled in by Cloudscape) can leave window.CSS without it.
  const css = ((window as { CSS?: Record<string, unknown> }).CSS ??= {});
  if (typeof css.supports !== 'function') css.supports = () => false;
}
