// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AggregatedView } from '@/lib/aggregations';
import { Dashboard } from '@/app/components/dashboard';

vi.mock('@/app/components/ai-summary-card', () => ({
  AiSummaryCard: () => <section aria-label="AI summary" />,
}));
vi.mock('@/app/components/kpi-cards', () => ({ KpiCards: () => <div /> }));
vi.mock('@/app/components/transactions-table', () => ({ TransactionsTable: () => <div /> }));
vi.mock('@/app/components/category-pie', () => ({ CategoryPie: () => <div /> }));
vi.mock('@/app/components/merchant-bar', () => ({ MerchantBar: () => <div /> }));
vi.mock('@/app/components/trend-chart', () => ({ TrendChart: () => <div /> }));
vi.mock('@/app/components/installment-area-chart', () => ({ InstallmentAreaChart: () => <div /> }));
vi.mock('@/app/components/reveal-panel', () => ({
  RevealPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const view = {} as AggregatedView;

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Dashboard AI summary card', () => {
  it('shows the AI summary card by default', () => {
    render(<Dashboard view={view} />);
    expect(screen.getByRole('region', { name: 'AI summary' })).toBeInTheDocument();
  });

  it('hides the AI summary card when NEXT_PUBLIC_ENABLE_AI_SUMMARY is false', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_AI_SUMMARY', 'false');
    render(<Dashboard view={view} />);
    expect(screen.queryByRole('region', { name: 'AI summary' })).toBeNull();
  });
});
