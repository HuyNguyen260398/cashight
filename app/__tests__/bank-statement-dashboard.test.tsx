// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BankStatementDashboard } from '../components/bank-statement-dashboard';
import { apiFetch } from '@/frontend/api/client';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
let search = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search), useRouter: () => router }));
vi.mock('@/frontend/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/frontend/auth/config', () => ({ getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.test' }) }));
// Chart sizing/animation is exercised in the browser suite; keep data hooks real here.
vi.mock('../components/dashboard', () => ({ Dashboard: () => <section aria-label="Spending analytics" /> }));
const tpb = { statementId: '2026-07-1111', bank: 'TPBank', cardLast4: '1111', statementDate: '2026-07-01', totalSpend: 100, transactionCount: 1, uploadedAt: '2026-08-01T00:00:00Z' };
const vib = { ...tpb, statementId: '2026-06-2222', bank: 'VIB', cardLast4: '2222', statementDate: '2026-06-01' };
function dashboard(bank = 'VIB', statementCount = 0) {
  return { spec: { type: 'month', year: 2026, month: 7 }, label: 'July 2026', selectedBank: bank, availableBanks: ['TPBank', 'VIB'], statementCount,
    totals: { totalSpend: 0, totalInstallments: 0, totalCashback: 0, totalFeesAndInterest: 0 },
    transactions: [], byCategory: [], topMerchants: [], subPeriods: [], installmentSubPeriods: [] };
}
beforeEach(() => { vi.clearAllMocks(); search = 'bank=VIB&period=month&year=2026&month=7'; });
afterEach(cleanup);

it.each(['TPBank', 'VIB'])('keeps upload and bank-only history visible in an empty period for %s', async (bank) => {
  search = `bank=${bank}&period=month&year=2026&month=7`;
  vi.mocked(apiFetch).mockImplementation(async (url) => Response.json(url.includes('/dashboard') ? dashboard(bank) : { items: [tpb, vib], nextCursor: null }));
  render(<BankStatementDashboard />);
  expect(screen.getByLabelText('Statement PDF')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(bank === 'VIB' ? '****2222' : '****1111')).toBeVisible());
  expect(screen.queryByText(bank === 'VIB' ? '****1111' : '****2222')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to latest' })).toHaveAttribute('href', `/?bank=${bank}`);
});

it('waits for API bank resolution on a period-only URL', async () => {
  search = 'period=month&year=2026&month=7';
  let resolve!: (value: Response) => void;
  vi.mocked(apiFetch).mockImplementation(async (url) => url.includes('/dashboard') ? new Promise((done) => { resolve = done; }) : Response.json({ items: [tpb, vib], nextCursor: null }));
  render(<BankStatementDashboard />);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  resolve(Response.json(dashboard('VIB')));
  await waitFor(() => expect(screen.getByText('****2222')).toBeVisible());
  expect(screen.queryByText('****1111')).not.toBeInTheDocument();
});

it('keeps upload/history usable when analytics fails', async () => {
  vi.mocked(apiFetch).mockImplementation(async (url) => {
    if (url.includes('/dashboard')) throw new Error('analytics offline');
    return Response.json({ items: [vib], nextCursor: null });
  });
  render(<BankStatementDashboard />);
  await waitFor(() => expect(screen.getByText('****2222')).toBeVisible());
  expect(screen.getByLabelText('Statement PDF')).toBeInTheDocument();
  expect(screen.getByText('analytics offline')).toBeVisible();
});

it('finds the initial bank month on a later page and retains the section fragment', async () => {
  search = 'bank=VIB';
  window.location.hash = 'statement-history';
  vi.mocked(apiFetch).mockImplementation(async (url) => Response.json(url.includes('cursor=') ? { items: [vib], nextCursor: null } : { items: [tpb], nextCursor: 'second' }));
  render(<BankStatementDashboard />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/?bank=VIB&period=month&year=2026&month=6#statement-history'));
  window.location.hash = '';
});

it('refreshes analytics after deleting the last statement without navigating', async () => {
  let deleted = false;
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    if (init?.method === 'DELETE') { deleted = true; return Response.json({ deleted: true }); }
    return Response.json(url.includes('/dashboard') ? dashboard('VIB', deleted ? 0 : 1) : { items: [vib], nextCursor: null });
  });
  render(<BankStatementDashboard />);
  await screen.findByText('****2222');
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByText('****2222')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('link', { name: 'Go to latest' })).toBeVisible());
  expect(router.push).not.toHaveBeenCalled();
});
