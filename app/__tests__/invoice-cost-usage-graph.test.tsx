// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CostExplorerReportRequestSchema } from '@cashight/domain/aws-cost-explorer';

import {
  InvoiceCostUsageGraph,
  invoiceCostReportRequest,
} from '@/app/components/aws-invoices/invoice-cost-usage-graph';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  useCostExplorer: vi.fn(),
  useSessionCapabilities: vi.fn(),
}));

vi.mock('@/frontend/hooks/use-cost-explorer', () => ({
  useCostExplorer: (...args: unknown[]) => mocks.useCostExplorer(...args),
}));

vi.mock('@/frontend/hooks/use-session-capabilities', () => ({
  useSessionCapabilities: () => mocks.useSessionCapabilities(),
}));

vi.mock('@/app/components/aws-cost-explorer/cognito-reauth-warning', () => ({
  CognitoReauthWarning: () => <div>Continue with Cognito</div>,
}));

vi.mock('@/app/components/aws-cost-explorer/cost-usage-graph', () => ({
  CostUsageGraph: ({
    request,
    chartStyle,
    onChartStyleChange,
  }: {
    request: { granularity: string; timePeriod: { start: string; end: string } };
    chartStyle: string;
    onChartStyleChange: (style: string) => void;
  }) => (
    <div>
      <p>
        Cost and usage graph {chartStyle} {request.granularity}{' '}
        {request.timePeriod.start}..{request.timePeriod.end}
      </p>
      <button onClick={() => onChartStyleChange('LINE')}>Line</button>
    </div>
  ),
}));

afterEach(() => cleanup());

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      status: 'success',
      request: invoiceCostReportRequest('2026-07', 'STACK'),
      result: { periods: [], series: [], currencyOrUnit: 'USD' },
      forecast: null,
      comparison: null,
      freshness: null,
      refreshCooldownUntil: null,
      error: null,
      ...(overrides.state as Record<string, unknown> | undefined),
    },
    reports: [],
    reportsLoading: false,
    reportsError: null,
    run: mocks.run,
    refresh: vi.fn(),
    saveReport: vi.fn(),
    deleteReport: vi.fn(),
    exportCsv: vi.fn(),
    cancel: vi.fn(),
  };
}

describe('invoiceCostReportRequest', () => {
  it('scopes a valid daily per-service report to the month, end date exclusive', () => {
    const request = invoiceCostReportRequest('2026-07', 'STACK');
    expect(request.timePeriod).toEqual({ start: '2026-07-01', end: '2026-08-01' });
    expect(request.granularity).toBe('DAILY');
    expect(request.metric).toBe('UnblendedCost');
    expect(request.groupBy).toEqual([{ type: 'DIMENSION', key: 'SERVICE' }]);
    expect(request.showForecast).toBe(false);
    expect(() => CostExplorerReportRequestSchema.parse(request)).not.toThrow();
  });

  it('rolls the year for December', () => {
    expect(invoiceCostReportRequest('2026-12', 'BAR').timePeriod).toEqual({
      start: '2026-12-01',
      end: '2027-01-01',
    });
  });
});

describe('InvoiceCostUsageGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useCostExplorer.mockReturnValue(hookState());
    mocks.useSessionCapabilities.mockReturnValue({
      data: { canViewAwsCosts: true },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
  });

  it('never asks the hook for the saved-report list it does not render', () => {
    render(<InvoiceCostUsageGraph yearMonth="2026-07" />);
    expect(mocks.useCostExplorer).toHaveBeenCalledWith({ loadReports: false });
  });

  it('queries the displayed month once and re-queries when the month changes', () => {
    const { rerender } = render(<InvoiceCostUsageGraph yearMonth="2026-07" />);
    rerender(<InvoiceCostUsageGraph yearMonth="2026-07" />);
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.run.mock.calls[0][0].timePeriod.start).toBe('2026-07-01');

    rerender(<InvoiceCostUsageGraph yearMonth="2026-06" />);
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls[1][0].timePeriod.start).toBe('2026-06-01');
  });

  it('changes chart style without spending another AWS query', () => {
    render(<InvoiceCostUsageGraph yearMonth="2026-07" />);
    expect(screen.getByText(/Cost and usage graph STACK/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    expect(screen.getByText(/Cost and usage graph LINE/)).toBeTruthy();
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it('warns instead of querying when the session cannot view AWS costs', () => {
    mocks.useSessionCapabilities.mockReturnValue({
      data: { canViewAwsCosts: false },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<InvoiceCostUsageGraph yearMonth="2026-07" />);
    expect(screen.getByText('Continue with Cognito')).toBeTruthy();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('shows a skeleton while capabilities and the report load', () => {
    mocks.useSessionCapabilities.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      reload: vi.fn(),
    });
    const { rerender } = render(<InvoiceCostUsageGraph yearMonth="2026-07" />);
    expect(screen.getByLabelText('Loading cost and usage graph')).toBeTruthy();

    mocks.useSessionCapabilities.mockReturnValue({
      data: { canViewAwsCosts: true },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    mocks.useCostExplorer.mockReturnValue(
      hookState({ state: { status: 'loading', result: null } }),
    );
    rerender(<InvoiceCostUsageGraph yearMonth="2026-07" />);
    expect(screen.getByLabelText('Loading cost and usage graph')).toBeTruthy();
  });

  it.each([
    ['COGNITO_REAUTH_REQUIRED', 'Continue with Cognito'],
    ['AWS_COST_THROTTLED', 'Slow down'],
  ])('renders the %s error in the panel only', (code, message) => {
    mocks.useCostExplorer.mockReturnValue(
      hookState({
        state: { status: 'error', result: null, error: { code, message } },
      }),
    );
    render(<InvoiceCostUsageGraph yearMonth="2026-07" />);
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText(/Cost and usage graph STACK/)).toBeNull();
  });
});
