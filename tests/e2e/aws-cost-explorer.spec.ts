import { readFile } from 'node:fs/promises';

import { expect, test, type Page, type Request } from '@playwright/test';

const API_URL = `http://localhost:${process.env.E2E_API_PORT ?? '8887'}`;

type CostRequest = {
  request: Record<string, unknown>;
  refresh?: boolean;
};

function costApiRequest(page: Page, route: string): Promise<Request> {
  return page.waitForRequest(
    (request) =>
      request.url() === `${API_URL}/aws/cost-explorer/${route}` &&
      request.method() === 'POST',
  );
}

async function applyReport(page: Page, route = 'query'): Promise<CostRequest> {
  const requestPromise = costApiRequest(page, route);
  await page.getByRole('button', { name: 'Apply report' }).click();
  const request = await requestPromise;
  const body = request.postDataJSON() as CostRequest;
  await expect(
    page.getByRole('heading', { name: 'Cost and usage overview' }),
  ).toBeVisible();
  return body;
}

async function chooseFirstFilterValue(page: Page, label: string) {
  await page.getByRole('button', { name: `Choose ${label} values` }).click();
  const value = page.getByText('Example Service 01', { exact: true }).last();
  await expect(value).toBeVisible();
  await value.click();
  await page.getByRole('button', { name: `Close ${label} values` }).click();
}

test.describe('AWS Cost Explorer browser parity', () => {
  test.describe.configure({ mode: 'serial' });

  test('exercises report families, all chart styles, comparison, and URL reload', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/aws/cost-explorer/');

    for (const title of [
      'Cost and usage overview',
      'Cost and usage graph',
      'Cost and usage breakdown',
      'Report parameters',
    ]) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }
    await expect(page.getByText(/Live AWS data|Cached AWS data/)).toBeVisible();
    await expect(page.getByRole('img', { name: /stacked bar chart/i })).toBeVisible();

    // Overview headline tiles, matching the AWS console panel.
    for (const tile of ['Total cost', 'Average monthly cost', 'Service count']) {
      await expect(page.getByText(tile, { exact: true })).toBeVisible();
    }
    // The breakdown table sits directly under its graph, not below the sidebar.
    const graphBox = await page
      .getByRole('heading', { name: 'Cost and usage graph' })
      .boundingBox();
    const breakdownBox = await page
      .getByRole('heading', { name: 'Cost and usage breakdown' })
      .boundingBox();
    const parametersBox = await page
      .getByRole('heading', { name: 'Report parameters' })
      .boundingBox();
    expect(breakdownBox!.y).toBeGreaterThan(graphBox!.y);
    expect(breakdownBox!.x).toBeLessThan(parametersBox!.x);

    // The graph's own toggle restyles the chart with no further AWS query.
    const chartType = page.getByRole('group', { name: 'Chart type' });
    let queried = false;
    const countQuery = () => {
      queried = true;
    };
    page.on('request', (request) => {
      if (request.url().includes('/aws/cost-explorer/query')) countQuery();
    });
    await chartType.getByRole('button', { name: 'Line' }).click();
    await expect(page.getByRole('img', { name: /line chart/i })).toBeVisible();
    await expect(page).toHaveURL(/chart=LINE/);
    await chartType.getByRole('button', { name: 'Bar', exact: true }).click();
    await expect(page.getByRole('img', { name: /^Bar chart/i })).toBeVisible();
    await chartType.getByRole('button', { name: 'Stacked bar' }).click();
    await expect(page.getByRole('img', { name: /stacked bar chart/i })).toBeVisible();
    expect(queried).toBe(false);
    // The parameters select follows the toggle.
    await expect(page.getByLabel('Chart style')).toHaveValue('STACK');
    await expect(
      page
        .getByLabel('Report mode', { exact: true })
        .locator('option[value="RESOURCE"]'),
    ).toHaveAttribute('disabled', '');

    await page.getByLabel('Date range').selectOption('CUSTOM');
    await page.getByLabel('Start date').fill('2026-04-01');
    await page.getByLabel('End date').fill('2026-07-01');
    await page.getByLabel('Billing view').focus();
    await page.getByLabel('Billing view').selectOption({ label: 'Local primary' });
    await page.getByLabel('Metric').selectOption('AmortizedCost');
    await page.getByLabel('Granularity').selectOption('DAILY');
    await page.getByLabel('Chart style').selectOption('BAR');
    await page.getByLabel('Group 1 type').selectOption('DIMENSION');
    await page.getByLabel('Group 1 key').selectOption('REGION');
    await page.getByLabel('Group 2 type').selectOption('TAG');
    await page.getByLabel('Group 2 key').fill('Environment');

    await page.getByRole('button', { name: 'Add filter' }).click();
    await chooseFirstFilterValue(page, 'Service');
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.getByLabel('Filter 2 category').selectOption('TAG');
    await page.getByLabel('Filter 2 key').fill('Owner');
    await chooseFirstFilterValue(page, 'Owner');
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.getByLabel('Filter 3 category').selectOption('COST_CATEGORY');
    await page.getByLabel('Filter 3 key').fill('Team');
    await chooseFirstFilterValue(page, 'Team');
    await page.getByLabel('Show only untagged').click();
    await page.getByLabel('Show only uncategorized').click();

    const barRequest = await applyReport(page);
    expect(barRequest.request).toMatchObject({
      mode: 'STANDARD',
      billingViewArn:
        'arn:aws:billing::000000000000:billingview/local-primary',
      timePeriod: { start: '2026-04-01', end: '2026-07-01' },
      granularity: 'DAILY',
      metric: 'AmortizedCost',
      chartStyle: 'BAR',
      groupBy: [
        { type: 'DIMENSION', key: 'REGION' },
        { type: 'TAG', key: 'Environment' },
      ],
      showOnlyUntagged: true,
      showOnlyUncategorized: true,
    });
    expect(barRequest.request.filter).toEqual({
      And: [
        {
          Dimensions: {
            Key: 'SERVICE',
            Values: ['Example Service 01'],
            MatchOptions: ['EQUALS'],
          },
        },
        {
          Tags: {
            Key: 'Owner',
            Values: ['Example Service 01'],
            MatchOptions: ['EQUALS'],
          },
        },
        {
          CostCategories: {
            Key: 'Team',
            Values: ['Example Service 01'],
            MatchOptions: ['EQUALS'],
          },
        },
      ],
    });
    await expect(page.getByRole('img', { name: /^Bar chart/i })).toBeVisible();

    await page.getByLabel('Chart style').selectOption('STACK');
    await applyReport(page);
    await expect(page.getByRole('img', { name: /stacked bar chart/i })).toBeVisible();
    await page.getByLabel('Chart style').selectOption('LINE');
    await applyReport(page);
    await expect(page.getByRole('img', { name: /line chart/i })).toBeVisible();

    const reportUrl = page.url();
    await page.reload();
    await expect(page.getByLabel('Metric')).toHaveValue('AmortizedCost');
    await expect(page.getByLabel('Chart style')).toHaveValue('LINE');
    await expect(page.getByLabel('Group 1 type')).toHaveValue('DIMENSION');
    await expect(page.getByLabel('Group 1 key')).toHaveValue('REGION');
    await expect(page.getByLabel('Group 2 type')).toHaveValue('TAG');
    await expect(page.getByLabel('Group 2 key')).toHaveValue('Environment');
    await expect(page.getByLabel('Filter 1 category')).toHaveValue(
      'DIMENSION',
    );
    await expect(page.getByLabel('Filter 1 dimension')).toHaveValue('SERVICE');
    await expect(
      page.getByRole('button', { name: 'Choose Service values' }),
    ).toContainText('1 selected');
    await expect(page.getByLabel('Filter 2 category')).toHaveValue('TAG');
    await expect(page.getByLabel('Filter 2 key')).toHaveValue('Owner');
    await expect(
      page.getByRole('button', { name: 'Choose Owner values' }),
    ).toContainText('1 selected');
    await expect(page.getByLabel('Filter 3 category')).toHaveValue(
      'COST_CATEGORY',
    );
    await expect(page.getByLabel('Filter 3 key')).toHaveValue('Team');
    await expect(
      page.getByRole('button', { name: 'Choose Team values' }),
    ).toContainText('1 selected');
    await expect(page).toHaveURL(reportUrl);

    await page.getByRole('button', { name: 'Reset report' }).click();
    await page.getByLabel('Group 1 type').selectOption('NONE');
    await page.getByLabel('Chart style').selectOption('BAR');
    await page.getByLabel('Show forecast').click();
    const forecastPromise = costApiRequest(page, 'forecast');
    await applyReport(page);
    await forecastPromise;
    await expect(
      page.getByRole('button', { name: 'Hide Forecast series' }),
    ).toBeVisible();

    await page
      .getByLabel('Report mode', { exact: true })
      .selectOption('COMPARISON');
    await page.getByLabel('Comparison range').selectOption('MONTH_TO_MONTH');
    const comparisonRequest = await applyReport(page, 'comparisons');
    expect(comparisonRequest.request).toMatchObject({
      mode: 'COMPARISON',
      comparisonTimePeriod: expect.any(Object),
      showForecast: false,
    });
    await expect(page.getByText('Cost drivers')).toBeVisible();
    await expect(page.getByText('Example Compute')).toBeVisible();
  });

  test('verifies cache refresh, saved reports, CSV, responsive layout, and keyboard use', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/aws/cost-explorer/');
    await expect(page.getByText(/AWS data|Cached AWS data/)).toBeVisible();

    await applyReport(page);
    await expect(page.getByText('Cached AWS data')).toBeVisible();

    const refreshRequest = costApiRequest(page, 'query');
    const refreshButton = page.getByRole('button', { name: 'Refresh from AWS' });
    await refreshButton.focus();
    await page.keyboard.press('Enter');
    const refreshBody = (await refreshRequest).postDataJSON() as CostRequest;
    expect(refreshBody.refresh).toBe(true);
    await expect(page.getByText('Live AWS data')).toBeVisible();
    await expect(refreshButton).toBeDisabled();
    await expect(page.getByText(/Manual refresh available after/)).toBeVisible();

    const reportName = `E2E parity ${Date.now()}`;
    await page.getByLabel('Report name').fill(reportName);
    await page.getByRole('button', { name: 'Save as new' }).click();
    await expect(page.getByText('Report saved.')).toBeVisible();
    await page.getByLabel('Report name').fill(`${reportName} renamed`);
    await page.getByRole('button', { name: 'Rename report' }).click();
    await expect(page.getByText('Report renamed.')).toBeVisible();

    await page.reload();
    await page.getByLabel('Saved report', { exact: true }).selectOption({
      label: `${reportName} renamed`,
    });
    await page.getByRole('button', { name: 'Load report' }).click();
    await expect(page.getByLabel('Metric')).toHaveValue('UnblendedCost');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^cashight-cost-explorer-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const csv = await readFile(downloadPath!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = csv.slice(1).trim().split('\r\n');
    expect(rows[0]).toMatch(
      /^Group 1,Currency\/Unit,Total,\d{4}-\d{2}-\d{2}/,
    );
    expect(rows[1]).toMatch(/^Example Compute,USD,\d+\.\d{2},/);
    expect(rows[1].split(',')).toHaveLength(rows[0].split(',').length);

    const reportNameInput = page.getByLabel('Report name');
    await reportNameInput.focus();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Save as new' }),
    ).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(reportNameInput).toBeFocused();

    const legend = page.locator('[aria-label="Chart legend"] button').first();
    await legend.focus();
    await page.keyboard.press('Space');
    await expect(legend).toHaveAttribute('aria-pressed', 'false');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('desktop-cost-breakdown')).toBeHidden();
    await expect(
      page.getByRole('article').filter({ hasText: 'Example Compute' }).first(),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.getByTestId('desktop-cost-breakdown')).toBeVisible();

    await page.getByLabel('Saved report', { exact: true }).selectOption({
      label: `${reportName} renamed`,
    });
    await page.getByRole('button', { name: 'Delete report' }).click();
    await page.getByRole('button', { name: 'Confirm delete report' }).click();
    await expect(page.getByText('Report deleted.')).toBeVisible();
  });

  test('denies Google capability before cost requests and preserves native re-auth state', async ({
    page,
  }) => {
    let costRequestCount = 0;
    await page.route(`${API_URL}/session/capabilities`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ canViewAwsCosts: false }),
      });
    });
    await page.route(`${API_URL}/aws/cost-explorer/**`, async (route) => {
      costRequestCount += 1;
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'COGNITO_REAUTH_REQUIRED',
            message: 'Native Cognito sign-in is required.',
          },
        }),
      });
    });
    await page.route(`${API_URL}/_oidc/.well-known/openid-configuration`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          issuer: `${API_URL}/_oidc`,
          authorization_endpoint: `${API_URL}/_oidc/authorize`,
          token_endpoint: `${API_URL}/_oidc/token`,
          jwks_uri: `${API_URL}/_oidc/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        }),
      });
    });

    await page.goto('/aws/cost-explorer/');
    await expect(
      page.getByRole('heading', {
        name: 'Continue with Cognito to view AWS costs',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Cost and usage overview' }),
    ).toHaveCount(0);
    expect(costRequestCount).toBe(0);

    const authorizeRequest = page.waitForRequest(
      (request) => request.url().startsWith(`${API_URL}/_oidc/authorize?`),
    );
    await page.route(`${API_URL}/_oidc/authorize?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Fake Cognito authorization</title>',
      });
    });
    await page.getByRole('button', { name: 'Continue with Cognito' }).click();
    const authorizeUrl = new URL((await authorizeRequest).url());
    expect(authorizeUrl.searchParams.has('identity_provider')).toBe(false);

    await page.waitForLoadState('domcontentloaded');
    await page.goto('/aws/cost-explorer/');
    const oidcState = await page.evaluate(() => [
      ...Object.values(window.localStorage),
      ...Object.values(window.sessionStorage),
    ]);
    expect(oidcState.some((value) => value.includes('/aws/cost-explorer/'))).toBe(
      true,
    );
    expect(costRequestCount).toBe(0);
  });
});
