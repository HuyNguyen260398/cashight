import { expect, test, type Page } from '@playwright/test';

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

// Cloudscape renders the side navigation inside AppLayout's navigation
// landmark; breadcrumbs are a separate landmark, so scope by the nav panel.
function sideNav(page: Page) {
  return page.locator('[data-testid="console-side-navigation"]');
}

test.describe('dashboard navigation', () => {
  test('opens Cost Explorer from bare home', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/aws\/cost-explorer\/$/);
    await expect(page.getByRole('heading', { name: 'AWS Cost Explorer' })).toBeVisible();
    await expect(sideNav(page).getByRole('link')).toHaveText([
      'Cost Explorer', 'Billing Invoice', 'TPB', 'VIB',
    ]);
  });

  test('supports expanded hierarchy, active descendants, and bank query links', async ({
    page,
  }) => {
    const errors = captureBrowserErrors(page);
    await page.goto('/aws/cost-explorer/');

    await expect(page.getByRole('heading', { name: 'AWS Cost Explorer' })).toBeVisible();
    const navigation = sideNav(page);
    for (const group of ['Dashboard', 'AWS budget', 'Bank statements']) {
      await expect(navigation.getByRole('button', { name: group })).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(navigation.getByRole('link', { name: 'Cost Explorer' })).toHaveAttribute('aria-current', 'page');
    await expect(navigation.getByRole('link', { name: 'TPB' })).toHaveAttribute('href', '/?bank=TPBank');

    await navigation.getByRole('link', { name: 'VIB' }).click();
    await expect(page).toHaveURL(/\?bank=VIB(?:&|$)/);
    await expect(sideNav(page).getByRole('link', { name: 'VIB' })).toHaveAttribute('aria-current', 'page');
    await expect(sideNav(page).getByRole('link', { name: 'TPB' })).not.toHaveAttribute('aria-current', 'page');
    expect(errors).toEqual([]);
  });

  test('closes and reopens the desktop navigation with the keyboard', async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await page.goto('/aws/billing-invoice/');
    await page.getByRole('button', { name: 'Close side navigation' }).click();
    await expect(sideNav(page).getByRole('link', { name: 'Billing Invoice' })).toBeHidden();

    const open = page.getByRole('button', { name: 'Open side navigation' });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(sideNav(page).getByRole('link', { name: 'Billing Invoice' })).toHaveAttribute('aria-current', 'page');
    expect(errors).toEqual([]);
  });

  test('uses the full tree in the mobile drawer and navigates from it', async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/aws/billing-invoice/');
    await page.getByRole('button', { name: 'Open side navigation' }).click();

    const navigation = sideNav(page);
    await expect(navigation.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-expanded', 'true');
    await expect(navigation.getByRole('link', { name: 'Billing Invoice' })).toHaveAttribute('aria-current', 'page');
    await navigation.getByRole('link', { name: 'TPB' }).click();

    await expect(page).toHaveURL(/\?bank=TPBank(?:&|$)/);
    expect(errors).toEqual([]);
  });
});
