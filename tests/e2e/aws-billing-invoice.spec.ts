import { expect, test, type Page, type Route } from '@playwright/test';

const API_URL = `http://localhost:${process.env.E2E_API_PORT ?? '8887'}`;
const PRIVATE_SENTINEL = 'PRIVATE BILL TO 123 PRIVATE STREET';
const PDF = Buffer.from('%PDF-1.4\n% synthetic non-private browser fixture\n%%EOF\n');

type TerminalMode = 'CONFLICT' | 'SUCCEEDED' | 'UNSUPPORTED_AWS_INVOICE' | 'INVOICE_TOTAL_MISMATCH';

function invoice(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    seller: 'Amazon Web Services, Inc.',
    billingPeriod: {
      start: `${yearMonth}-01`,
      end: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
    },
    invoiceDate: `${yearMonth}-01`,
    dueDate: `${yearMonth}-15`,
    currency: 'USD',
    totals: { charges: 42, credits: 2, tax: 4.2, amountDue: 44.2 },
    services: [
      { name: 'Example Compute', charges: 30, tax: 3, total: 33 },
      { name: 'Example Storage', charges: 12, tax: 1.2, total: 13.2 },
    ],
    linkedAccounts: [
      {
        accountLast4: '0001',
        charges: 42,
        credits: 2,
        tax: 4.2,
        total: 44.2,
        services: [
          { name: 'Example Compute', charges: 30, tax: 3, total: 33 },
          { name: 'Example Storage', charges: 12, tax: 1.2, total: 13.2 },
        ],
      },
    ],
    source: {
      parserId: 'aws-inc-consolidated-usd',
      parserVersion: 1,
      sha256: '0'.repeat(64),
      uploadedAt: '2026-08-03T00:00:00.000Z',
    },
  };
}

function dashboard(yearMonth: string) {
  const selected = invoice(yearMonth);
  return {
    selected,
    yearMonth,
    kpis: {
      amountDue: 44.2,
      serviceCharges: 42,
      credits: 2,
      tax: 4.2,
      linkedAccountCount: 1,
      billedServiceCount: 2,
    },
    serviceBreakdown: [
      { name: 'Example Compute', value: 33, percentage: 71.43 },
      { name: 'Example Storage', value: 13.2, percentage: 28.57 },
    ],
    topServices: [
      { name: 'Example Compute', value: 33, percentage: 71.43 },
      { name: 'Example Storage', value: 13.2, percentage: 28.57 },
    ],
    chargeComposition: [
      { name: 'Charges', value: 42 },
      { name: 'Credits', value: 2 },
      { name: 'Tax', value: 4.2 },
    ],
    accountAllocations: [
      { accountLast4: '0001', value: 44.2, percentage: 100 },
    ],
    monthlyTrend: [
      { yearMonth: '2026-06', value: 38 },
      { yearMonth: '2026-07', value: 44.2 },
    ],
    serviceDetails: selected.services,
  };
}

function metadata(yearMonth: string) {
  return {
    yearMonth,
    currency: 'USD',
    amountDue: yearMonth === '2026-07' ? 44.2 : 38,
    tax: 4.2,
    serviceCount: 2,
    linkedAccountCount: 1,
    uploadedAt: '2026-08-03T00:00:00.000Z',
  };
}

function uploadJob(jobId: string, state: 'CONFLICT' | 'SUCCEEDED' | 'FAILED', force: boolean, errorCode?: string) {
  return {
    jobId,
    documentType: 'AWS_INVOICE',
    owner: { workspaceId: 'primary' },
    state,
    force,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:01.000Z',
    expiresAt: 1_800_000_000,
    ...(state === 'CONFLICT' ? { conflict: { year: 2026, month: 7 } } : {}),
    ...(state === 'SUCCEEDED' ? { yearMonth: '2026-07' } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockInvoiceApi(page: Page, terminalModes: TerminalMode[] = ['SUCCEEDED']) {
  const state = {
    createBodies: [] as Array<Record<string, unknown>>,
    dashboardMonths: [] as string[],
    historyRequests: 0,
    deleted: new Set<string>(),
    jobs: new Map<string, ReturnType<typeof uploadJob>>(),
  };

  const invoiceRoute = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (method === 'POST' && path === '/aws/invoices/uploads') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.createBodies.push(body);
      const force = body.force === true;
      const mode = force ? 'SUCCEEDED' : (terminalModes.shift() ?? 'SUCCEEDED');
      const jobId = `${String(state.createBodies.length).padStart(8, '0')}-0000-4000-8000-000000000000`;
      const terminal = mode === 'CONFLICT'
        ? uploadJob(jobId, 'CONFLICT', force)
        : mode === 'SUCCEEDED'
          ? uploadJob(jobId, 'SUCCEEDED', force)
          : uploadJob(jobId, 'FAILED', force, mode);
      state.jobs.set(jobId, terminal);
      await fulfillJson(route, {
        job: { ...terminal, state: 'PENDING_UPLOAD', conflict: undefined, yearMonth: undefined, errorCode: undefined },
        upload: {
          url: `${API_URL}/_e2e/invoice.pdf`,
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          expiresAt: '2026-08-03T00:05:00.000Z',
        },
      });
      return;
    }

    if (method === 'GET' && path.startsWith('/aws/invoices/uploads/')) {
      const jobId = decodeURIComponent(path.split('/').at(-1) ?? '');
      await fulfillJson(route, { job: state.jobs.get(jobId) });
      return;
    }

    if (method === 'POST' && path === '/aws/invoices/summary') {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'Aggregate charges increased, led by Example Compute. Account identifiers were not used.',
      });
      return;
    }

    if (method === 'GET' && path === '/aws/invoices/dashboard') {
      const yearMonth = url.searchParams.get('yearMonth') ?? '2026-07';
      state.dashboardMonths.push(yearMonth);
      if (state.deleted.has(yearMonth) || yearMonth === '2026-08') {
        await fulfillJson(route, { error: { code: 'NOT_FOUND', message: 'AWS invoice not found.' } }, 404);
      } else {
        await fulfillJson(route, { dashboard: dashboard(yearMonth) });
      }
      return;
    }

    if (path === '/aws/invoices' && method === 'GET') {
      state.historyRequests += 1;
      const items = ['2026-07', '2026-06']
        .filter((yearMonth) => !state.deleted.has(yearMonth))
        .map(metadata);
      await fulfillJson(route, { items, nextCursor: null });
      return;
    }

    const yearMonth = decodeURIComponent(path.split('/').at(-1) ?? '');
    if (method === 'DELETE') {
      state.deleted.add(yearMonth);
      await fulfillJson(route, { yearMonth, deleted: true });
      return;
    }
    if (method === 'GET' && /^\d{4}-\d{2}$/.test(yearMonth)) {
      if (state.deleted.has(yearMonth) || yearMonth === '2026-08') {
        await fulfillJson(route, { error: { code: 'NOT_FOUND', message: 'AWS invoice not found.' } }, 404);
      } else {
        await fulfillJson(route, { invoice: invoice(yearMonth) });
      }
      return;
    }
    await fulfillJson(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  };
  await page.route(`${API_URL}/aws/invoices`, invoiceRoute);
  await page.route(`${API_URL}/aws/invoices/**`, invoiceRoute);

  await page.route(`${API_URL}/_e2e/invoice.pdf`, async (route) => {
    expect(route.request().method()).toBe('PUT');
    expect(route.request().postDataBuffer()).toEqual(PDF);
    await route.fulfill({ status: 200, body: '' });
  });

  return state;
}

async function uploadPdf(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic-aws-invoice.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
}

test.describe('AWS billing invoice dashboard', () => {
  test('covers upload conflict/cancel/force, refresh, navigation, charts, table, history, delete, and AI', async ({ page }) => {
    const state = await mockInvoiceApi(page, ['CONFLICT', 'CONFLICT']);
    await page.goto('/aws/billing-invoice/?year=2026&month=7');

    await expect(page.getByRole('heading', { name: 'Billing invoices' })).toBeVisible();
    for (const label of [
      'Amount due',
      'Service charges',
      'Credits',
      'Tax',
      'Linked accounts',
      'Billed services',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    for (const chart of [
      'Monthly invoice trend line chart',
    ]) {
      await expect(page.getByRole('img', { name: chart })).toBeVisible();
    }
    await expect(page.locator('[data-dashboard-panel="cost-usage"]')).toBeVisible();
    await expect(page.getByText('Service details', { exact: true })).toBeVisible();
    await expect(page.getByText('Invoice history', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/\b\d{12}\b|invoiceNumber|billTo/i);

    const initialHistoryRequests = state.historyRequests;
    await uploadPdf(page);
    await expect(page.getByRole('heading', { name: 'Replace existing invoice?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Replace existing invoice?' })).toBeHidden();

    await uploadPdf(page);
    await expect(page.getByRole('heading', { name: 'Replace existing invoice?' })).toBeVisible();
    await page.getByRole('button', { name: 'Replace invoice' }).click();
    await expect.poll(() => state.historyRequests).toBeGreaterThan(initialHistoryRequests);
    expect(state.createBodies).toHaveLength(3);
    expect(state.createBodies.map((body) => body.force)).toEqual([false, false, true]);
    expect(state.createBodies[0].sha256).toMatch(/^[a-f0-9]{64}$/);

    await page.getByRole('button', { name: 'Generate AI summary' }).click();
    await expect(page.getByText(/Aggregate charges increased/)).toBeVisible();

    await page.getByRole('button', { name: 'Next invoice month' }).click();
    await expect(page).toHaveURL(/year=2026&month=8/);
    await expect(page.getByRole('heading', { name: 'No invoice for August 2026' })).toBeVisible();
    await page.getByRole('button', { name: 'Previous invoice month' }).click();
    await expect(page).toHaveURL(/year=2026&month=7/);
    await expect(page.locator('[data-dashboard-panel="cost-usage"]')).toBeVisible();
    await expect(page.getByText('Service details', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Delete July 2026' }).click();
    await expect(page.getByRole('heading', { name: 'Delete July 2026 invoice?' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete invoice' }).click();
    await expect(page).toHaveURL(/year=2026&month=6/);
    expect(state.deleted.has('2026-07')).toBe(true);
  });

  for (const [mode, message] of [
    ['UNSUPPORTED_AWS_INVOICE', 'not the supported AWS consolidated USD invoice layout'],
    ['INVOICE_TOTAL_MISMATCH', 'totals did not reconcile'],
  ] as const) {
    test(`fails closed for ${mode} without refreshing failed-month data`, async ({ page }) => {
      const state = await mockInvoiceApi(page, [mode]);
      await page.goto('/aws/billing-invoice/?year=2026&month=7');
      await expect(page.locator('[data-dashboard-panel="cost-usage"]')).toBeVisible();
      await expect(page.getByText('Service details', { exact: true })).toBeVisible();
      const dashboardRequests = state.dashboardMonths.length;

      await uploadPdf(page);
      await expect(page.getByText(new RegExp(message))).toBeVisible();
      expect(state.dashboardMonths).toHaveLength(dashboardRequests);
      await expect(page.locator('body')).not.toContainText(PRIVATE_SENTINEL);
    });
  }

  test('supports mobile and keyboard controls without horizontal overflow', async ({ page }) => {
    await mockInvoiceApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/aws/billing-invoice/?year=2026&month=7');
    const previous = page.getByRole('button', { name: 'Previous invoice month' });
    await previous.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/year=2026&month=6/);
    await expect(page.getByRole('button', { name: 'Generate AI summary' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('shows loading and terminal API error states without private content', async ({ page }) => {
    await page.route(`${API_URL}/aws/invoices/**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fulfillJson(route, { error: { code: 'UNAVAILABLE', message: 'Refresh unavailable' } }, 503);
    });
    await page.goto('/aws/billing-invoice/?year=2026&month=7');
    await expect(page.getByLabel('Loading AWS invoice dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: "Couldn't load AWS invoices" })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(PRIVATE_SENTINEL);
  });
});
