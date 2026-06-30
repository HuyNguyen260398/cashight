import { expect, test } from '@playwright/test';

test('sign-in page loads without a server error', async ({ page }) => {
  const response = await page.goto('/signin', { waitUntil: 'domcontentloaded' });

  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await expect(page.getByRole('heading', { name: 'Cashight' })).toBeVisible();
});

test.describe('authenticated application deep links', () => {
  test.skip(
    !process.env.E2E_STORAGE_STATE,
    'Set E2E_STORAGE_STATE to an authenticated Playwright storage-state file.',
  );

  for (const applicationPath of [
    '/?period=month&year=2026&month=5',
    '/upload',
    '/statements',
  ]) {
    test(`${applicationPath} avoids server errors`, async ({ page }) => {
      const response = await page.goto(applicationPath, {
        waitUntil: 'domcontentloaded',
      });

      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(500);
    });
  }
});
