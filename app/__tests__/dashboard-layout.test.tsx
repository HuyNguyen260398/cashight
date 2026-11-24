// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { AggregatedView } from '@/lib/aggregations';

vi.mock('@/app/components/charts/use-highcharts', () => ({ useHighcharts: () => null }));
vi.mock('@/frontend/api/client', () => ({ apiFetch: vi.fn(), ApiRequestError: class extends Error {} }));
vi.mock('@/frontend/auth/config', () => ({ getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.test' }) }));

import { Dashboard } from '../components/dashboard';

afterEach(cleanup);

const view = {
  spec: { type: 'month', year: 2026, month: 7 }, label: 'July 2026', statementCount: 1,
  totals: { totalSpend: 1_000_000, totalInstallments: 200_000, totalCashback: 5_000, totalFeesAndInterest: 0 },
  latestStatement: { statementBalance: 3_000_000, statementDate: '2026-07-25' },
  byCategory: [{ category: 'Software & Subscriptions', value: 99_000 }], topMerchants: [], transactions: [],
  subPeriods: [], installmentSubPeriods: [],
} as unknown as AggregatedView;

it('lays the dashboard out in Cloudscape containers with the existing section titles', () => {
  const { container } = render(<Dashboard view={view} />);
  const headers = createWrapper(container).findAllContainers().map((c) => c.findHeader()?.getElement().textContent ?? '');
  for (const title of ['AI summary', 'Spending trend', 'Total installments', 'Spending by category', 'Top merchants', 'Transactions']) {
    expect(headers.some((h) => h.includes(title))).toBe(true);
  }
});

it('shows every KPI with its value', () => {
  render(<Dashboard view={view} />);
  for (const label of ['Total Spend', 'Statement Balance', 'Installments', 'Software & Subscriptions', 'Fees & Interest', 'Cashback']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
  expect(screen.getByText(/1\.000\.000/)).toBeInTheDocument();
});
