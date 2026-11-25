import { expect, test } from '@playwright/test';

// AppLayout renders the page's <main>; pages inside the shell must not add a
// second one. Highcharts must also have its accessibility module, or every
// chart is an unlabelled image and Highcharts logs a warning per render.
for (const [name, url, chartLabel] of [
  ['bank dashboard', '/?bank=TPBank', 'Spending by category'],
  ['cost explorer', '/aws/cost-explorer/', 'Cost and usage graph'],
  ['billing invoice', '/aws/billing-invoice/', 'Monthly invoice trend'],
] as const) {
  test(`${name}: one main landmark and accessible charts`, async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('Highcharts warning')) warnings.push(message.text());
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url);
    await expect(page.getByRole('heading', { name: chartLabel }).first()).toBeVisible();
    await expect(page.locator('.highcharts-container').first()).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    expect(warnings).toEqual([]);
  });
}
