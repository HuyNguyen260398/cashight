// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LegacyStatementRedirect } from '../components/legacy-statement-redirect';
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
let search = '';
let authenticated = true;
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search), useRouter: () => ({ replace }) }));
vi.mock('@/frontend/auth/protected-route', () => ({ ProtectedRoute: ({ children }: { children: ReactNode }) => authenticated ? children : null }));
beforeEach(() => { vi.clearAllMocks(); search = ''; authenticated = true; });
afterEach(cleanup);

it.each(['statement-upload', 'statement-history'] as const)('redirects %s into a bank dashboard', async (section) => {
  render(<LegacyStatementRedirect section={section} />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(`/?bank=TPBank#${section}`));
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});
it('preserves a bank and period bookmark', async () => {
  search = 'bank=VIB&period=year&year=2026';
  render(<LegacyStatementRedirect section="statement-history" />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/?bank=VIB&period=year&year=2026#statement-history'));
});
it('waits for authentication before redirecting', () => {
  authenticated = false;
  render(<LegacyStatementRedirect section="statement-upload" />);
  expect(replace).not.toHaveBeenCalled();
});
