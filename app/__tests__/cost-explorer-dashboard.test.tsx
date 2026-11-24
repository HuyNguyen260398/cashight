// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CognitoReauthWarning } from '@/app/components/aws-cost-explorer/cognito-reauth-warning';
import { CostBreakdown } from '@/app/components/aws-cost-explorer/cost-breakdown';
import { CostExplorerDashboard } from '@/app/components/aws-cost-explorer/cost-explorer-dashboard';
import { CostOverview } from '@/app/components/aws-cost-explorer/cost-overview';
import { FilterBuilder } from '@/app/components/aws-cost-explorer/filter-builder';
import { chooseOption, selectedLabel } from './helpers/cloudscape-fields';
import { CostUsageGraph } from '@/app/components/aws-cost-explorer/cost-usage-graph';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import createChartWrapper from '@cloudscape-design/chart-components/test-utils/dom';

// Render real Highcharts synchronously; jsdom draws enough for the legend.
vi.mock('@/app/components/charts/use-highcharts', async () => {
  const Highcharts = (await import('highcharts')).default;
  return { useHighcharts: () => Highcharts };
});

function legendItems() {
  return createChartWrapper(document.body).findCartesianHighcharts()!.findLegend()!.findItems();
}
function legendItem(name: string) {
  const item = legendItems().find((i) => i.getElement().textContent === name);
  if (!item) throw new Error(`No legend item ${name}`);
  return item.getElement();
}
import type {
  CostExplorerComparison,
  CostExplorerCompleteResult,
} from '@/frontend/api/contracts';

const mockUseSessionCapabilities = vi.fn();
const mockUseCostExplorer = vi.fn();
const mockSigninRedirect = vi.fn();
const mockRun = vi.fn();
const mockRefresh = vi.fn();
const mockExportCsv = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/frontend/hooks/use-session-capabilities', () => ({
  useSessionCapabilities: () => mockUseSessionCapabilities(),
}));

vi.mock('@/frontend/hooks/use-cost-explorer', () => ({
  useCostExplorer: () => mockUseCostExplorer(),
}));

vi.mock('@/frontend/auth/oidc', () => ({
  getOidcManager: () => ({ signinRedirect: mockSigninRedirect }),
}));

const request: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-05-01', end: '2026-08-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

const breakdown = Array.from({ length: 12 }, (_, index) => ({
  groupValues: [index === 0 ? 'Amazon EC2' : `Service ${index + 1}`],
  values: [`${index + 1}.25`, `${index + 2}.50`, `${index + 3}.75`],
  total: `${(index + 1) * 10}.50`,
  estimated: index === 0,
}));

const result: CostExplorerCompleteResult = {
  source: 'CACHE',
  asOf: '2026-08-10T08:00:00.000Z',
  currencyOrUnit: 'USD',
  estimated: true,
  overview: {
    total: '1234.56',
    average: '411.52',
    currentMonthToDate: '90.25',
    previousTotal: '1000.00',
    absoluteChange: '234.56',
    percentageChange: '23.456',
  },
  periods: [
    { start: '2026-05-01', end: '2026-06-01', estimated: false },
    { start: '2026-06-01', end: '2026-07-01', estimated: false },
    { start: '2026-07-01', end: '2026-08-01', estimated: true },
  ],
  series: [
    ...Array.from({ length: 9 }, (_, index) => ({
      key: `service-${index + 1}`,
      label: index === 0 ? 'Amazon EC2' : `Service ${index + 1}`,
      values: [`${index + 1}`, `${index + 2}`, `${index + 3}`],
      total: `${(index + 2) * 10}`,
    })),
    {
      key: 'other',
      label: 'Other',
      values: ['3', '4', '5'],
      total: '12',
    },
  ],
  breakdown,
  comparisonDrivers: [],
  pageCount: 3,
};

const comparison: CostExplorerComparison = {
  comparisons: [
    {
      groupValues: ['Amazon EC2'],
      metrics: {
        UnblendedCost: {
          baseline: '100.00',
          comparison: '125.50',
          difference: '25.50',
          unit: 'USD',
        },
      },
    },
  ],
  total: {
    UnblendedCost: {
      baseline: '100.00',
      comparison: '125.50',
      difference: '25.50',
      unit: 'USD',
    },
  },
  drivers: [
    {
      groupValues: ['Amazon EC2'],
      name: 'Amazon EC2 increase',
      type: 'SERVICE',
      metrics: {
        UnblendedCost: {
          baseline: '100.00',
          comparison: '125.50',
          difference: '25.50',
          unit: 'USD',
        },
      },
    },
  ],
  pageCount: 1,
};

function hookState(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof mockUseCostExplorer> {
  return {
    state: {
      status: 'success',
      request,
      result,
      forecast: null,
      comparison: null,
      freshness: { source: 'CACHE', asOf: result.asOf },
      refreshCooldownUntil: null,
      error: null,
    },
    reports: [],
    reportsLoading: false,
    reportsError: null,
    run: mockRun,
    refresh: mockRefresh,
    saveReport: vi.fn(),
    deleteReport: vi.fn(),
    exportCsv: mockExportCsv,
    cancel: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSessionCapabilities.mockReturnValue({
    data: { canViewAwsCosts: true },
    loading: false,
    error: null,
    reload: vi.fn(),
  });
  mockUseCostExplorer.mockReturnValue(hookState());
  mockSigninRedirect.mockResolvedValue(undefined);
  mockExportCsv.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('Cost Explorer capability states', () => {
  it('shows a persistent native re-auth warning without invoking the report hook', async () => {
    mockUseSessionCapabilities.mockReturnValue({
      data: {
        canViewAwsCosts: false,
        reason: 'COGNITO_REAUTH_REQUIRED',
      },
      loading: false,
      error: null,
      reload: vi.fn(),
    });

    render(<CostExplorerDashboard />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Continue with Cognito to view AWS costs',
    );
    expect(mockUseCostExplorer).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue with Cognito' }),
    );
    expect(mockSigninRedirect).toHaveBeenCalledWith({
      state: { returnTo: '/aws/cost-explorer/' },
    });
  });

  it('runs the URL/default report only for a native capability', async () => {
    render(<CostExplorerDashboard />);

    expect(
      screen.getByRole('heading', { name: 'Report parameters' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'STANDARD',
        metric: 'UnblendedCost',
      }),
    );
  });

  it('does not flash financial panels while capability or query state loads', () => {
    mockUseSessionCapabilities.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      reload: vi.fn(),
    });
    const first = render(<CostExplorerDashboard />);
    expect(screen.getByText('Checking AWS cost access…')).toBeInTheDocument();
    expect(screen.queryByText('$1,234.56')).not.toBeInTheDocument();
    expect(mockUseCostExplorer).not.toHaveBeenCalled();

    first.unmount();
    mockUseSessionCapabilities.mockReturnValue({
      data: { canViewAwsCosts: true },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    mockUseCostExplorer.mockReturnValue(
      hookState({
        state: {
          status: 'loading',
          request,
          result: null,
          forecast: null,
          comparison: null,
          freshness: null,
          refreshCooldownUntil: null,
          error: null,
        },
      }),
    );
    render(<CostExplorerDashboard />);
    expect(screen.getByText('Loading cost and usage…')).toBeInTheDocument();
    expect(screen.queryByText('$1,234.56')).not.toBeInTheDocument();
  });

  it('recovers from a backend Cognito denial with the native re-auth action', () => {
    mockUseCostExplorer.mockReturnValue(
      hookState({
        state: {
          status: 'error',
          request,
          result: null,
          forecast: null,
          comparison: null,
          freshness: null,
          refreshCooldownUntil: null,
          error: {
            code: 'COGNITO_REAUTH_REQUIRED',
            message: 'A native Cognito session is required.',
          },
        },
      }),
    );

    render(<CostExplorerDashboard />);

    expect(
      screen.getByRole('button', { name: 'Continue with Cognito' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Cost and usage overview' }),
    ).not.toBeInTheDocument();
  });
});

describe('Cost Explorer panel states', () => {
  it('renders the four exact panel titles and data provenance', () => {
    render(<CostExplorerDashboard />);

    for (const title of [
      'Cost and usage overview',
      'Cost and usage graph',
      'Cost and usage breakdown',
      'Report parameters',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('Cached AWS data')).toBeInTheDocument();
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(screen.getByText(/Updated Aug 10, 2026/)).toBeInTheDocument();
    expect(screen.getByText('$1,234.56')).toBeInTheDocument();
  });

  it('collapses and restores the report parameters panel without losing a draft', async () => {
    render(<CostExplorerDashboard />);

    const toggle = () =>
      screen.getByRole('button', { name: /report parameters$/ });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('heading', { name: 'Report parameters' }),
    ).toBeInTheDocument();

    // An unapplied edit must survive the collapse.
    chooseOption('Metric', 'AmortizedCost');

    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    // The panel stays mounted — below xl it is a slide-over that has to remain
    // in the box tree to animate, and unmounting would drop the draft below.
    // `inert` is what makes it unreachable while collapsed; the column itself
    // is dropped by `xl:hidden`, which jsdom has no stylesheet to apply.
    expect(screen.getByRole('complementary', { hidden: true })).toHaveAttribute(
      'inert',
    );
    // Collapsing is presentational only.
    expect(mockRun).toHaveBeenCalledTimes(1);

    await userEvent.click(toggle());
    expect(
      screen.getByRole('heading', { name: 'Report parameters' }),
    ).toBeInTheDocument();
    expect(selectedLabel('Metric')).toBe('Amortized cost');
  });

  it('summarises the range as total cost, average, and distinct service count', () => {
    render(<CostExplorerDashboard />);

    expect(screen.getByText('Total cost')).toBeInTheDocument();
    expect(screen.getByText('$1,234.56')).toBeInTheDocument();
    expect(screen.getByText('Average monthly cost')).toBeInTheDocument();
    expect(screen.getByText('$411.52')).toBeInTheDocument();
    // 12 breakdown rows, one distinct service each — not the 10 capped series.
    expect(screen.getByText('Service count')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('labels the average by granularity and only counts a SERVICE grouping', () => {
    const daily = render(
      <CostOverview
        request={{ ...request, granularity: 'DAILY' }}
        result={result}
        forecast={null}
        comparison={null}
      />,
    );
    expect(screen.getByText('Average daily cost')).toBeInTheDocument();
    daily.unmount();

    render(
      <CostOverview
        request={{
          ...request,
          groupBy: [{ type: 'DIMENSION', key: 'REGION' }],
        }}
        result={result}
        forecast={null}
        comparison={null}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(
      screen.getByText('Group by service to count services'),
    ).toBeInTheDocument();
  });

  it('switches chart style from the graph toggle without re-running the query', async () => {
    render(<CostExplorerDashboard />);
    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));

    const toggle = within(screen.getByRole('toolbar', { name: 'Chart type' }));
    expect(toggle.getByRole('button', { name: 'Stacked bar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('img', { name: /stacked bar chart/i }),
    ).toBeInTheDocument();

    await userEvent.click(toggle.getByRole('button', { name: 'Line' }));
    expect(screen.getByRole('img', { name: /line chart/i })).toBeInTheDocument();
    expect(toggle.getByRole('button', { name: 'Line' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(window.location.search).toContain('chart=LINE');

    await userEvent.click(toggle.getByRole('button', { name: 'Bar' }));
    expect(screen.getByRole('img', { name: /^Bar chart/i })).toBeInTheDocument();
    // Presentational only: no extra AWS round trip.
    expect(mockRun).toHaveBeenCalledTimes(1);
    // The parameters select follows the toggle, so Apply cannot revert it.
    expect(selectedLabel('Chart style')).toBe('Bar');
  });

  it('renders graph styles, top-nine-plus-Other, and legend toggles', async () => {
    const view = render(
      <CostUsageGraph request={request} result={result} forecast={null} comparison={null} />,
    );

    expect(
      screen.getByRole('img', { name: /stacked bar chart/i }),
    ).toBeInTheDocument();
    expect(legendItems()).toHaveLength(10);
    expect(legendItem('Other')).toBeInTheDocument();

    // Cloudscape legend: clicking an item isolates that series.
    await userEvent.click(legendItem('Amazon EC2'));
    expect(legendItem('Amazon EC2')).toHaveAttribute('aria-pressed', 'true');
    expect(legendItem('Other')).toHaveAttribute('aria-pressed', 'false');

    view.rerender(
      <CostUsageGraph
        request={{ ...request, chartStyle: 'LINE' }}
        result={result}
        forecast={null}
        comparison={null}
      />,
    );
    expect(screen.getByRole('img', { name: /line chart/i })).toBeInTheDocument();
    // A presentational style change keeps the hidden series hidden.
    expect(legendItem('Other')).toHaveAttribute('aria-pressed', 'false');
    view.rerender(
      <CostUsageGraph
        request={{
          ...request,
          chartStyle: 'LINE',
          timePeriod: { start: '2026-02-01', end: '2026-05-01' },
        }}
        result={result}
        forecast={null}
        comparison={null}
      />,
    );
    // A different report resets legend visibility.
    expect(legendItem('Other')).toHaveAttribute('aria-pressed', 'true');
    view.rerender(
      <CostUsageGraph
        request={{ ...request, chartStyle: 'LINE' }}
        result={{
          ...result,
          series: [
            {
              key: 'database',
              label: 'Amazon RDS',
              values: ['2', '3', '4'],
              total: '9',
            },
          ],
        }}
        forecast={null}
        comparison={null}
      />,
    );
    expect(legendItem('Amazon RDS')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows empty and unavailable forecast states instead of blank panels', () => {
    const emptyResult: CostExplorerCompleteResult = {
      ...result,
      overview: { total: '0', average: '0' },
      periods: [],
      series: [],
      breakdown: [],
    };
    render(
      <>
        <CostOverview
          request={request}
          result={emptyResult}
          forecast={null}
          comparison={null}
        />
        <CostUsageGraph
          request={{ ...request, showForecast: true }}
          result={emptyResult}
          forecast={null}
          comparison={null}
        />
        <CostBreakdown request={request} result={emptyResult} comparison={null} />
      </>,
    );

    expect(screen.getByText('No cost data for this report.')).toBeInTheDocument();
    expect(screen.getByText('Forecast unavailable')).toBeInTheDocument();
    expect(screen.getByText('No breakdown rows for this report.')).toBeInTheDocument();
  });

  it('renders an available forecast as a toggleable chart series', () => {
    render(
      <CostUsageGraph
        request={{ ...request, showForecast: true }}
        result={result}
        forecast={{
          total: '1400.00',
          unit: 'USD',
          periods: [
            {
              start: '2026-08-01',
              end: '2026-09-01',
              mean: '450.00',
              lowerBound: '400.00',
              upperBound: '500.00',
            },
          ],
        }}
        comparison={null}
      />,
    );

    expect(legendItem('Forecast')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the complete breakdown sortable and paginated', async () => {
    render(<CostBreakdown request={request} result={result} comparison={null} />);
    const table = within(screen.getByTestId('desktop-cost-breakdown'));

    expect(table.getAllByRole('row')).toHaveLength(11);
    await userEvent.click(table.getByRole('button', { name: 'Sort by Total' }));
    expect(table.getByRole('columnheader', { name: 'Total' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(table.getAllByRole('row')[1]).toHaveTextContent('Service 12');
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'true');
    expect(table.getAllByRole('row')).toHaveLength(3);
  });

  it('renders comparison columns and cost drivers', () => {
    const comparisonRequest: CostExplorerReportRequest = {
      ...request,
      mode: 'COMPARISON',
      comparisonTimePeriod: { start: '2026-02-01', end: '2026-05-01' },
    };
    render(
      <>
        <CostBreakdown
          request={comparisonRequest}
          result={null}
          comparison={comparison}
        />
        <CostUsageGraph
          request={comparisonRequest}
          result={null}
          forecast={null}
          comparison={comparison}
        />
      </>,
    );

    expect(screen.getByRole('columnheader', { name: 'Baseline' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Comparison' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Difference' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cost drivers' })).toBeInTheDocument();
    expect(screen.getByText('Amazon EC2 increase')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /across 1 group$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Baseline: \$100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Comparison: \$125\.50/)).toBeInTheDocument();
  });

  it('masks linked-account identifiers in tables, charts, filters, and accessible text', async () => {
    const accountId = '123456789012';
    const sameLastFourAccountId = '999999999012';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <CostBreakdown
          request={{
            ...request,
            groupBy: [{ type: 'DIMENSION', key: 'LINKED_ACCOUNT' }],
          }}
          result={{
            ...result,
            breakdown: [
              { ...breakdown[0], groupValues: [accountId] },
              {
                ...breakdown[1],
                groupValues: [sameLastFourAccountId],
              },
            ],
          }}
          comparison={null}
        />
        <CostUsageGraph
          request={{
            ...request,
            groupBy: [{ type: 'DIMENSION', key: 'LINKED_ACCOUNT' }],
          }}
          result={{
            ...result,
            series: [
              {
                key: accountId,
                label: accountId,
                values: ['1', '2', '3'],
                total: '6',
              },
            ],
          }}
          forecast={null}
          comparison={null}
        />
        <FilterBuilder
          value={{
            Dimensions: {
              Key: 'LINKED_ACCOUNT',
              Values: [accountId],
              MatchOptions: ['EQUALS'],
            },
          }}
          timePeriod={request.timePeriod}
          onChange={vi.fn()}
        />
      </>,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Choose Linked account values' }),
    );

    expect(document.body.textContent).not.toContain(accountId);
    expect(document.body.textContent).not.toContain(sameLastFourAccountId);
    expect(document.body.innerHTML).not.toContain(accountId);
    expect(document.body.innerHTML).not.toContain(sameLastFourAccountId);
    expect(screen.getAllByText('Linked account •••• 9012').length).toBeGreaterThan(0);
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'same key',
    );
    consoleError.mockRestore();
  });

  it('enforces refresh cooldown and exports the complete active query', async () => {
    mockUseCostExplorer.mockReturnValue(
      hookState({
        state: {
          ...hookState().state,
          refreshCooldownUntil: '2099-08-10T08:05:00.000Z',
        },
      }),
    );
    render(<CostExplorerDashboard />);

    expect(screen.getByRole('button', { name: 'Refresh from AWS' })).toBeDisabled();
    expect(screen.getByText(/Manual refresh available/)).toBeInTheDocument();

    // Export belongs to the breakdown panel, not the page header.
    const exportButton = screen.getByRole('button', { name: 'Export CSV' });
    const breakdownPanel = screen.getByTestId('desktop-cost-breakdown');
    expect(breakdownPanel).toContainElement(
      screen.getByRole('heading', { name: 'Cost and usage breakdown' }),
    );
    expect(breakdownPanel).toContainElement(exportButton);

    await userEvent.click(exportButton);
    await waitFor(() => expect(mockExportCsv).toHaveBeenCalledWith(request));
  });
});

describe('Cognito re-auth return state', () => {
  it('renders as a Cloudscape warning alert with a heading', () => {
    const { container } = render(<CognitoReauthWarning />);
    expect(createWrapper(container).findAlert()).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Continue with Cognito to view AWS costs' })).toBeInTheDocument();
  });

  it('starts native managed login with the exact allowlisted Cost Explorer route', async () => {
    render(<CognitoReauthWarning />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue with Cognito' }),
    );

    expect(mockSigninRedirect).toHaveBeenCalledWith({
      state: { returnTo: '/aws/cost-explorer/' },
    });
    expect(mockSigninRedirect.mock.calls[0][0]).not.toHaveProperty(
      'extraQueryParams.identity_provider',
    );
  });
});
