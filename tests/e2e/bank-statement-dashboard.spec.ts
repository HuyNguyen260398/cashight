import { expect, test, type Page } from '@playwright/test';

const API_URL = `http://localhost:${process.env.E2E_API_PORT ?? '8887'}`;
const PDF = Buffer.from('%PDF-1.4\n% synthetic browser fixture\n%%EOF\n');
const base = { transactionCount: 1, uploadedAt: '2026-08-01T00:00:00Z' };
const tpb = { ...base, statementId: '2026-07-1111', bank: 'TPBank', cardLast4: '1111', statementDate: '2026-07-01', totalSpend: 100 };
const vib = { ...base, statementId: '2026-06-2222', bank: 'VIB', cardLast4: '2222', statementDate: '2026-06-01', totalSpend: 200 };

async function fixture(page: Page, options: { empty?: boolean; missingId?: boolean } = {}) {
  const state = { items: options.empty ? [] : [tpb, vib], failHistory: false, failDelete: false, dashboardRequests: 0, uploadBank: 'VIB', uploadMonth: 8, amount: 300, conflict: false };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('status of 503') && !message.text().includes('status of 403')) errors.push(message.text()); });
  await page.route(`${API_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/statements') {
      if (state.failHistory) return route.fulfill({ status: 503, json: { error: 'offline' } });
      // Selected bank may only exist on the second API page.
      return route.fulfill({ json: url.searchParams.has('cursor')
        ? { items: state.items.slice(1), nextCursor: null }
        : { items: state.items.slice(0, 1), nextCursor: state.items.length > 1 ? 'second-page' : null } });
    }
    if (path.startsWith('/statements/') && route.request().method() === 'DELETE') {
      if (state.failDelete) return route.fulfill({ status: 403, json: { error: 'denied' } });
      state.items = state.items.filter((item) => item.statementId !== path.split('/').pop());
      return route.fulfill({ json: { deleted: true } });
    }
    if (path === '/dashboard') {
      state.dashboardRequests++;
      const bank = url.searchParams.get('bank') ?? 'VIB';
      const year = Number(url.searchParams.get('year'));
      const month = Number(url.searchParams.get('month'));
      const selected = state.items.filter((item) => item.bank === bank && item.statementDate.startsWith(`${year}-${String(month).padStart(2, '0')}`));
      return route.fulfill({ json: {
        spec: { type: 'month', year, month }, label: `${year}-${month}`, statementCount: selected.length,
        selectedBank: bank, availableBanks: ['TPBank', 'VIB'],
        totals: { totalSpend: selected.reduce((sum, item) => sum + item.totalSpend, 0), totalInstallments: 0, totalCashback: 0, totalFeesAndInterest: 0 },
        transactions: [], byCategory: [], topMerchants: [], subPeriods: [], installmentSubPeriods: [],
      } });
    }
    const job = { jobId: '550e8400-e29b-41d4-a716-446655440000', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
    if (path === '/uploads') {
      if (route.request().postDataJSON().force) state.conflict = false;
      return route.fulfill({ json: { job: { ...job, state: 'PENDING_UPLOAD' }, upload: {
        url: `${API_URL}/synthetic-pdf`, method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, expiresAt: '2027-01-01T00:00:00Z',
      } } });
    }
    if (path === '/synthetic-pdf') return route.fulfill({ status: 200, body: '' });
    if (path.startsWith('/uploads/')) {
      if (state.conflict) return route.fulfill({ json: { job: { ...job, state: 'CONFLICT', conflict: { cardLast4: '2222', year: 2026, month: state.uploadMonth } } } });
      const template = state.uploadBank === 'VIB' ? vib : tpb;
      const month = String(state.uploadMonth).padStart(2, '0');
      const uploaded = { ...template, statementId: `2026-${month}-${template.cardLast4}`, statementDate: `2026-${month}-01`, totalSpend: state.amount };
      state.items = [...state.items.filter((item) => item.statementId !== uploaded.statementId), uploaded];
      return route.fulfill({ json: { job: { ...job, state: 'SUCCEEDED', ...(options.missingId ? {} : { statementId: uploaded.statementId }) } } });
    }
    return route.continue();
  });
  return { state, errors };
}

async function upload(page: Page) {
  await page.getByLabel('Statement PDF').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: PDF });
}

test('bank pages keep history isolated, retain links, and support mobile/light/dark layouts', async ({ page }, testInfo) => {
  const { errors } = await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const bank of ['TPBank', 'VIB']) {
    await page.goto(`/?bank=${bank}`);
    await expect(page).toHaveURL(new RegExp(`bank=${bank}.*period=month`));
    const history = page.locator('#statement-history');
    await expect(history.getByText(bank === 'VIB' ? '****2222' : '****1111')).toBeVisible();
    await expect(history.getByText(bank === 'VIB' ? '****1111' : '****2222')).toHaveCount(0);
    await expect(history.getByRole('link')).toHaveAttribute('href', new RegExp(`bank=${bank}`));
    for (const mobile of [false, true]) {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), mobile);
      await expect(page.locator('#statement-upload')).toBeVisible();
      // The shell animates desktop sidebar padding when crossing the breakpoint.
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${bank}-${mobile ? 'mobile-dark' : 'desktop-light'}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test('follows a cross-bank upload, refreshes same-month overwrite, and deletes without navigation', async ({ page }) => {
  const { state, errors } = await fixture(page);
  await page.goto('/?bank=TPBank&period=month&year=2026&month=7');
  await upload(page);
  await expect(page).toHaveURL(/bank=VIB&period=month&year=2026&month=8/);
  const history = page.locator('#statement-history');
  await expect(history.getByRole('link', { name: '2026-08' })).toBeVisible();
  await expect(history.getByText('****1111')).toHaveCount(0);
  const requests = state.dashboardRequests;
  state.amount = 900;
  state.conflict = true;
  await upload(page);
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: /overwrite|replace/i }).click();
  await expect(history.getByRole('row').filter({ hasText: '2026-08' })).toContainText('900');
  expect(state.dashboardRequests).toBeGreaterThan(requests);
  state.failDelete = true;
  await history.getByRole('row').filter({ hasText: '2026-08' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  state.failDelete = false;
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(history.getByRole('link', { name: '2026-08' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Go to latest' })).toBeVisible();
  await expect(page).toHaveURL(/bank=VIB&period=month&year=2026&month=8/);
  await page.getByRole('link', { name: 'Go to latest' }).click();
  await expect(page).toHaveURL(/bank=VIB&period=month&year=2026&month=6/);
  expect(errors).toEqual([]);
});

test('retired bookmarks reach inline sections and history errors can be retried', async ({ page }) => {
  const { state } = await fixture(page);
  state.failHistory = true;
  await page.goto('/statements/?bank=VIB');
  await expect(page).toHaveURL(/bank=VIB#statement-history/);
  await expect(page.getByRole('button', { name: 'Retry history' })).toBeVisible();
  await expect(page.getByLabel('Statement PDF')).toBeAttached();
  state.failHistory = false;
  await page.getByRole('button', { name: 'Retry history' }).click();
  await expect(page).toHaveURL(/bank=VIB&period=month&year=2026&month=6#statement-history/);
  await expect(page.locator('#statement-history').getByText('****2222')).toBeVisible();
  await page.goto('/upload/?bank=TPBank');
  await expect(page).toHaveURL(/bank=TPBank.*#statement-upload/);
});

test('allows a first upload from an empty bank and keeps saved status when completion metadata lacks an ID', async ({ page }) => {
  await fixture(page, { empty: true, missingId: true });
  await page.goto('/?bank=VIB');
  await expect(page.getByText('No VIB statements uploaded yet')).toBeVisible();
  await upload(page);
  await expect(page.getByRole('button', { name: 'Refresh saved statement' })).toBeVisible();
  await expect(page.locator('#statement-history').getByRole('link', { name: '2026-08' })).toBeVisible();
  await expect(page).toHaveURL(/\?bank=VIB$/);
  await page.locator('#statement-history').getByRole('link', { name: '2026-08' }).click();
  await expect(page).toHaveURL(/month=8/);
  await page.getByRole('button', { name: 'Next period' }).click();
  await page.getByRole('link', { name: 'Go to latest' }).click();
  await expect(page).toHaveURL(/bank=VIB&period=month&year=2026&month=8/);
  await expect(page.getByRole('button', { name: 'Refresh saved statement' })).toHaveCount(0);
});


test('does not navigate away from a new bank when an older upload finishes', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  let started!: () => void;
  const polling = new Promise<void>((resolve) => { started = resolve; });
  await page.route(`${API_URL}/uploads/*`, async (route) => {
    started();
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { job: {
      jobId: '550e8400-e29b-41d4-a716-446655440000', state: 'SUCCEEDED',
      statementId: '2026-07-1111', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    } } });
  });
  await page.goto('/?bank=TPBank&period=month&year=2026&month=7');
  await upload(page);
  await polling;
  await page.getByRole('navigation').getByRole('link', { name: 'VIB' }).click();
  await expect(page).toHaveURL(/bank=VIB.*month=6/);
  const completed = page.waitForResponse((response) => response.url().includes('/uploads/'));
  release();
  await completed;
  await expect(page.locator('#statement-history').getByText('****2222')).toBeVisible();
  await expect(page).toHaveURL(/bank=VIB.*month=6/);
});

test('opens the first successfully uploaded statement from an empty bank', async ({ page }) => {
  await fixture(page, { empty: true });
  await page.goto('/?bank=VIB');
  await expect(page.getByText('No VIB statements uploaded yet')).toBeVisible();
  await upload(page);
  await expect(page).toHaveURL(/bank=VIB&period=month&year=2026&month=8/);
  await expect(page.locator('#statement-history').getByRole('link', { name: '2026-08' })).toBeVisible();
});
