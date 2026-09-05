// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDashboard } from '../hooks/use-dashboard';
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../api/client', () => ({ apiFetch: mockApiFetch }));
vi.mock('../auth/config', () => ({ getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.test' }) }));
const jsonResponse = (body: unknown) => Response.json(body);
afterEach(cleanup);
const MONTH_SPEC = { type: 'month' as const, year: 2026, month: 5 };

const DASHBOARD_PAYLOAD = {
  spec: MONTH_SPEC,
  statementCount: 1,
  label: 'May 2026',
  totals: { totalSpend: 0, totalInstallments: 0, totalCashback: 0, totalFeesAndInterest: 0 },
  transactions: [],
  byCategory: [],
  topMerchants: [],
  subPeriods: [],
  installmentSubPeriods: [],
};

  it('refreshes data for an unchanged bank and period', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(DASHBOARD_PAYLOAD))
      .mockResolvedValueOnce(jsonResponse({ ...DASHBOARD_PAYLOAD, statementCount: 0 }));
    const { result } = renderHook(() => useDashboard(MONTH_SPEC, 'VIB'));
    await waitFor(() => expect(result.current.data?.statementCount).toBe(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data?.statementCount).toBe(0));
  });
