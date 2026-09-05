// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { BankStatementHistory } from '../components/bank-statement-history';
import type { StatementListItem } from '@/frontend/api/contracts';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
const items: StatementListItem[] = Array.from({ length: 13 }, (_, index) => ({
  statementId: `2026-07-${1000 + index}`, bank: 'TPBank', cardLast4: String(1000 + index),
  statementDate: '2026-07-01', totalSpend: index + 1, transactionCount: 1, uploadedAt: '2026-08-01T00:00:00Z',
}));
items.push({ ...items[0], statementId: '2026-06-2222', bank: 'VIB', cardLast4: '2222', statementDate: '2026-06-01' });
const actions = { onDelete: vi.fn(), onRetry: vi.fn() };

it('filters before pagination and resets the page when the bank changes', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<BankStatementHistory items={items} bank="TPBank" loading={false} error={null} {...actions} />);
  expect(screen.getAllByRole('row')).toHaveLength(13);
  expect(screen.queryByText('****2222')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /next/i }));
  expect(screen.getAllByRole('row')).toHaveLength(2);
  rerender(<BankStatementHistory items={items} bank="VIB" loading={false} error={null} {...actions} />);
  expect(screen.getByText('****2222')).toBeVisible();
  expect(screen.queryByText('****1000')).not.toBeInTheDocument();
  const url = new URL(screen.getByRole('link', { name: '2026-06' }).getAttribute('href')!, 'https://example.test');
  expect(url.searchParams.get('bank')).toBe('VIB');
  expect(url.searchParams.get('month')).toBe('6');
});

it('never shows mixed history before the API resolves a bank', () => {
  render(<BankStatementHistory items={items} bank={null} loading={false} error={null} {...actions} />);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('keeps loaded rows and offers retry on refresh failure', async () => {
  render(<BankStatementHistory items={items} bank="VIB" loading={false} error="offline" {...actions} />);
  expect(screen.getByText('****2222')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('offline');
  await userEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(actions.onRetry).toHaveBeenCalled();
});

it('requires confirmation and preserves a row on cancelled deletion', async () => {
  render(<BankStatementHistory items={items} bank="VIB" loading={false} error={null} {...actions} />);
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = screen.getByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('****2222')).toBeVisible();
  expect(actions.onDelete).not.toHaveBeenCalled();
});
