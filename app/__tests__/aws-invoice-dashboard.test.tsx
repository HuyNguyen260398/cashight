// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwsInvoiceDashboard as AwsInvoiceDashboardData } from '@cashight/domain/aws-invoices';

import {
  AwsInvoiceDashboard,
  parseInvoiceYearMonth,
  shiftInvoiceMonth,
} from '@/app/components/aws-invoices/aws-invoice-dashboard';
import { AwsInvoiceAiSummary } from '@/app/components/aws-invoices/aws-invoice-ai-summary';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  search: 'year=2026&month=7',
  useInvoices: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@/frontend/api/client', () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
  ApiRequestError: class ApiRequestError extends Error {
    constructor(public status: number, public body: unknown) {
      super(`API request failed with status ${status}`);
    }
  },
}));

vi.mock('@/frontend/auth/config', () => ({
  getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.com' }),
}));

vi.mock('@/frontend/hooks/use-aws-invoices', () => ({
  useAwsInvoices: (...args: unknown[]) => mocks.useInvoices(...args),
}));

vi.mock('@/app/components/reveal-panel', () => ({
  RevealPanel: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));

vi.mock('@/app/components/aws-invoices/aws-invoice-upload', () => ({
  AwsInvoiceUpload: () => <div data-testid="upload-panel">Upload panel</div>,
}));
vi.mock('@/app/components/aws-invoices/invoice-kpi-cards', () => ({
  InvoiceKpiCards: () => <div>KPI panel</div>,
}));
vi.mock('@/app/components/aws-invoices/invoice-monthly-trend', () => ({
  InvoiceMonthlyTrend: () => <div>Trend panel</div>,
}));
vi.mock('@/app/components/aws-invoices/invoice-cost-usage-graph', () => ({
  InvoiceCostUsageGraph: ({ yearMonth }: { yearMonth: string }) => (
    <div>Cost and usage graph for {yearMonth}</div>
  ),
}));
vi.mock('@/app/components/aws-invoices/invoice-services-table', () => ({
  InvoiceServicesTable: () => <div>Services table</div>,
}));
vi.mock('@/app/components/aws-invoices/invoice-history', () => ({
  InvoiceHistory: ({ onSelect, onDelete }: { onSelect: (month: string) => void; onDelete: (month: string) => Promise<void> }) => (
    <div>
      History panel
      <button onClick={() => onSelect('2026-06')}>Select June</button>
      <button onClick={() => void onDelete('2026-07')}>Delete July</button>
    </div>
  ),
}));
afterEach(() => cleanup());

const history = [
  {
    yearMonth: '2026-07' as const,
    currency: 'USD' as const,
    amountDue: 127,
    tax: 12,
    serviceCount: 2,
    linkedAccountCount: 1,
    uploadedAt: '2026-08-03T12:00:00.000Z',
  },
  {
    yearMonth: '2026-06' as const,
    currency: 'USD' as const,
    amountDue: 100,
    tax: 10,
    serviceCount: 1,
    linkedAccountCount: 1,
    uploadedAt: '2026-07-03T12:00:00.000Z',
  },
];
const dashboard = {
  yearMonth: '2026-07',
  selected: { currency: 'USD', services: [] },
  kpis: {},
  serviceBreakdown: [],
  topServices: [],
  chargeComposition: [],
  accountAllocations: [],
  monthlyTrend: [],
  serviceDetails: [],
} as unknown as AwsInvoiceDashboardData;

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    invoice: dashboard.selected,
    dashboard,
    history,
    nextCursor: null,
    loading: false,
    deleting: false,
    error: null,
    deleteInvoice: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    ...overrides,
  };
}

describe('AWS invoice month state and dashboard composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = 'year=2026&month=7';
    mocks.useInvoices.mockReturnValue(hookState());
  });

  it('parses valid URL state, rejects malformed state, and shifts across years', () => {
    expect(parseInvoiceYearMonth(new URLSearchParams('year=2026&month=7'))).toBe('2026-07');
    expect(parseInvoiceYearMonth(new URLSearchParams('year=2026&month=13'))).toBeNull();
    expect(parseInvoiceYearMonth(new URLSearchParams('year=x&month=7'))).toBeNull();
    expect(shiftInvoiceMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftInvoiceMonth('2026-12', 1)).toBe('2027-01');
  });

  it('loads the valid URL month and renders panels in responsive document order', () => {
    render(<AwsInvoiceDashboard />);
    expect(mocks.useInvoices).toHaveBeenCalledWith('2026-07');
    expect(
      Array.from(document.querySelectorAll('[data-dashboard-panel]')).map((node) => node.getAttribute('data-dashboard-panel')),
    ).toEqual(['kpis', 'ai', 'trend', 'cost-usage', 'table', 'history']);
  });

  it('scopes the cost and usage graph to the displayed month and drops the retired panels', () => {
    render(<AwsInvoiceDashboard />);
    expect(screen.getByText('Cost and usage graph for 2026-07')).toBeTruthy();
    for (const heading of [
      'Service breakdown',
      'Top services',
      'Linked account allocation',
      'Charge and tax composition',
    ]) {
      expect(screen.queryByText(heading)).toBeNull();
    }
  });

  it.each([
    ['', '2026-07'],
    ['year=bad&month=15', '2026-07'],
  ])('defaults %s to the latest stored invoice', async (search, expected) => {
    mocks.search = search;
    mocks.useInvoices.mockReturnValue(hookState({ invoice: null, dashboard: null }));
    render(<AwsInvoiceDashboard />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/aws/billing-invoice/?year=2026&month=7`));
    expect(expected).toBe('2026-07');
  });

  it('uses the current month when there is no invoice history', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00.000Z'));
    mocks.search = '';
    mocks.useInvoices.mockReturnValue(hookState({ invoice: null, dashboard: null, history: [] }));
    render(<AwsInvoiceDashboard />);
    await act(async () => Promise.resolve());
    expect(mocks.replace).toHaveBeenCalledWith('/aws/billing-invoice/?year=2026&month=8');
    vi.useRealTimers();
  });

  it('navigates previous, next, and history months through canonical URLs', () => {
    render(<AwsInvoiceDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous invoice month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next invoice month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select June' }));
    expect(mocks.push.mock.calls.map(([href]) => href)).toEqual([
      '/aws/billing-invoice/?year=2026&month=6',
      '/aws/billing-invoice/?year=2026&month=8',
      '/aws/billing-invoice/?year=2026&month=6',
    ]);
  });

  it('navigates to the next available month after deleting the selection', async () => {
    const deleteInvoice = vi.fn().mockResolvedValue(undefined);
    mocks.useInvoices.mockReturnValue(hookState({ deleteInvoice }));
    render(<AwsInvoiceDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete July' }));
    await waitFor(() => expect(deleteInvoice).toHaveBeenCalledWith('2026-07'));
    expect(mocks.push).toHaveBeenCalledWith('/aws/billing-invoice/?year=2026&month=6');
  });

  it('renders loading, API error, and empty-month states without hiding upload', () => {
    const { rerender } = render(<AwsInvoiceDashboard />);
    mocks.useInvoices.mockReturnValue(hookState({ loading: true, invoice: null, dashboard: null }));
    rerender(<AwsInvoiceDashboard />);
    expect(screen.getByLabelText('Loading AWS invoice dashboard')).toBeTruthy();
    mocks.useInvoices.mockReturnValue(hookState({ error: 'Unavailable', invoice: null, dashboard: null }));
    rerender(<AwsInvoiceDashboard />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('upload-panel')).toBeTruthy();
    mocks.useInvoices.mockReturnValue(hookState({ invoice: null, dashboard: null }));
    rerender(<AwsInvoiceDashboard />);
    expect(screen.getByText(/No invoice for July 2026/i)).toBeTruthy();
  });

  it('keeps the last valid dashboard visible with a retryable refresh error', () => {
    mocks.useInvoices.mockReturnValue(hookState({ error: 'Refresh unavailable' }));
    render(<AwsInvoiceDashboard />);
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh unavailable');
    expect(screen.getByText('KPI panel')).toBeTruthy();
  });
});

describe('AWS invoice AI summary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fetch until clicked and sends yearMonth only', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('Aggregate insight'));
    render(<AwsInvoiceAiSummary yearMonth="2026-07" />);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /generate ai summary/i }));
    await waitFor(() => expect(screen.getByText('Aggregate insight')).toBeTruthy());
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).toEqual({ yearMonth: '2026-07' });
  });

  it('reads streamed text and caches completed summaries per month', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('First '));
        controller.enqueue(new TextEncoder().encode('summary'));
        controller.close();
      },
    });
    mocks.apiFetch.mockResolvedValue(new Response(stream));
    const { rerender } = render(<AwsInvoiceAiSummary yearMonth="2026-07" />);
    fireEvent.click(screen.getByRole('button', { name: /generate ai summary/i }));
    await waitFor(() => expect(screen.getByText('First summary')).toBeTruthy());
    rerender(<AwsInvoiceAiSummary yearMonth="2026-08" />);
    expect(screen.getByRole('button', { name: /generate ai summary/i })).toBeTruthy();
    rerender(<AwsInvoiceAiSummary yearMonth="2026-07" />);
    expect(screen.getByText('First summary')).toBeTruthy();
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
  });

  it('aborts an in-flight request when the month changes', async () => {
    let aborted = false;
    mocks.apiFetch.mockImplementation((_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => undefined);
    });
    const { rerender } = render(<AwsInvoiceAiSummary yearMonth="2026-07" />);
    fireEvent.click(screen.getByRole('button', { name: /generate ai summary/i }));
    rerender(<AwsInvoiceAiSummary yearMonth="2026-08" />);
    await waitFor(() => expect(aborted).toBe(true));
  });

  it.each([
    [429, 'busy'],
    [503, 'unavailable'],
  ])('maps upstream HTTP %s errors', async (status, message) => {
    const { ApiRequestError } = await import('@/frontend/api/client');
    mocks.apiFetch.mockRejectedValue(new ApiRequestError(status, null));
    render(<AwsInvoiceAiSummary yearMonth="2026-07" />);
    fireEvent.click(screen.getByRole('button', { name: /generate ai summary/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(message, 'i')));
  });
});
