// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HomePage from '../page';
import type { ReactNode } from 'react';
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
let search = '';
let authenticated = true;
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams(search) }));
vi.mock('@/frontend/auth/protected-route', () => ({ ProtectedRoute: ({ children }: { children: ReactNode }) => authenticated ? children : null }));
vi.mock('../components/bank-statement-dashboard', () => ({ BankStatementDashboard: () => <div>Bank view</div> }));
vi.mock('@/frontend/hooks/use-dashboard', () => ({ useDashboard: () => ({ data: null, loading: true, error: null }) }));
vi.mock('@/frontend/api/client', () => ({ apiFetch: async () => Response.json({ items: [], nextCursor: null }) }));
vi.mock('@/frontend/auth/config', () => ({ getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.test' }) }));
beforeEach(() => { search = ''; authenticated = true; vi.clearAllMocks(); });
afterEach(cleanup);

it('sends bare home to Cost Explorer', async () => {
  render(<HomePage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/aws/cost-explorer/'));
});
it.each(['bank=TPBank', 'bank=VIB', 'period=year&year=2026'])('retains bank URLs: %s', (query) => {
  search = query;
  render(<HomePage />);
  expect(screen.getByText('Bank view')).toBeVisible();
  expect(replace).not.toHaveBeenCalled();
});
it('does not redirect or mount protected content before authentication', () => {
  authenticated = false;
  render(<HomePage />);
  expect(replace).not.toHaveBeenCalled();
  expect(screen.queryByText('Bank view')).not.toBeInTheDocument();
});
