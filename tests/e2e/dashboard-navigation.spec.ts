import { expect, test, type Page } from '@playwright/test';

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('dashboard navigation', () => {
  test('opens Cost Explorer from bare home', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/aws\/cost-explorer\/$/);
    await expect(page.getByRole('heading', { name: 'AWS Cost Explorer' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link')).toHaveText([
      'Cost Explorer', 'Billing Invoice', 'TPB', 'VIB',
    ]);
  });

  test('supports expanded hierarchy, active descendants, and bank query links', async ({
    page,
  }) => {
    const errors = captureBrowserErrors(page);
    await page.goto('/aws/cost-explorer/');

    await expect(
      page.getByRole('heading', { name: 'AWS Cost Explorer' }),
    ).toBeVisible();
    const navigation = page.getByRole('navigation');
    await expect(
      navigation.getByRole('button', { name: 'Dashboard' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(
      navigation.getByRole('button', { name: 'AWS budget' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(
      navigation.getByRole('link', { name: 'Cost Explorer' }),
    ).toHaveAttribute('aria-current', 'page');

    const bankStatements = navigation.getByRole('button', {
      name: 'Bank statements',
    });
    await bankStatements.focus();
    await expect(bankStatements).toHaveAttribute('aria-expanded', 'true');
    await expect(navigation.getByRole('link', { name: 'TPB' })).toHaveAttribute(
      'href',
      '/?bank=TPBank',
    );
    await navigation.getByRole('link', { name: 'VIB' }).click();
    await expect(page).toHaveURL(/\?bank=VIB(?:&|$)/);
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'VIB' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(errors).toEqual([]);
  });

  test('opens the collapsed desktop flyout with the keyboard and restores focus', async ({
    page,
  }) => {
    const errors = captureBrowserErrors(page);
    await page.goto('/aws/billing-invoice/');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();

    const dashboardButton = page
      .getByRole('navigation')
      .getByRole('button', { name: 'Dashboard' });
    await dashboardButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Dashboard' })).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Billing Invoice' }),
    ).toHaveAttribute('aria-current', 'page');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Dashboard' })).toBeHidden();
    await expect(dashboardButton).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('uses the full tree in the mobile drawer and closes after leaf navigation', async ({
    page,
  }) => {
    const errors = captureBrowserErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/aws/billing-invoice/');
    await page.getByRole('button', { name: 'Open navigation' }).click();

    const navigation = page.getByRole('navigation');
    await expect(
      navigation.getByRole('button', { name: 'Dashboard' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(
      navigation.getByRole('link', { name: 'Billing Invoice' }),
    ).toHaveAttribute('aria-current', 'page');
    await navigation.getByRole('link', { name: 'TPB' }).click();

    await expect(page).toHaveURL(/\?bank=TPBank(?:&|$)/);
    await expect(
      page.getByRole('button', { name: 'Open navigation' }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
