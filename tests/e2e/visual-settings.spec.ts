import { expect, test } from '@playwright/test';

// Cloudscape defines its theme tokens on <body>; the dark class must land there.
const bodyIsDark = () => document.body.classList.contains('awsui-dark-mode');
const layoutBackground = () => {
  const main = document.querySelector('main') ?? document.body;
  let el: Element | null = main;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    el = el.parentElement;
  }
  return '';
};

test.describe('visual settings', () => {
  test('switches to dark mode live and keeps it across reloads before hydration', async ({ page }) => {
    await page.goto('/aws/billing-invoice/');
    const nav = page.locator('[data-testid="console-side-navigation"]');
    await expect(nav).toBeVisible();
    const lightBackground = await nav.evaluate((el) => getComputedStyle(el.closest('nav') ?? el).backgroundColor);

    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dark' }).click();
    await expect.poll(() => page.evaluate(bodyIsDark)).toBe(true);
    await expect
      .poll(() => nav.evaluate((el) => getComputedStyle(el.closest('nav') ?? el).backgroundColor))
      .not.toBe(lightBackground);

    // The pre-paint script must apply the class before React hydrates.
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(bodyIsDark)).toBe(true);
    expect(await page.evaluate(layoutBackground)).not.toBe('');
  });

  test('applies compact density', async ({ page }) => {
    await page.goto('/aws/billing-invoice/');
    await page.getByRole('button', { name: 'Density' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Compact' }).click();
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('awsui-compact-mode'))).toBe(true);
  });
});
