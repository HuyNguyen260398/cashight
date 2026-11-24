// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { afterEach, expect, it } from 'vitest';
import type { Transaction } from '@/lib/schemas';
import { TransactionsTable } from '../components/transactions-table';

afterEach(cleanup);

function tx(day: number, amountVnd: number, category = 'Shopping'): Transaction {
  const date = `2026-07-${String(day).padStart(2, '0')}`;
  return { date, postingDate: date, description: `Merchant ${day}`, currency: 'VND', originalAmount: Math.abs(amountVnd), amountVnd, category, isInstallment: false, isInternational: false };
}

const rows = Array.from({ length: 25 }, (_, i) => tx(i + 1, (i + 1) * 1000));

function bodyRows(container: HTMLElement) {
  return createWrapper(container).findTable()!.findRows();
}

it('is a Cloudscape table showing 10 rows per page, newest first', () => {
  const { container } = render(<TransactionsTable transactions={rows} />);
  const tableRows = bodyRows(container);
  expect(tableRows).toHaveLength(10);
  expect(tableRows[0].getElement()).toHaveTextContent('2026-07-25');
  expect(createWrapper(container).findPagination()!.findPageNumbers()).toHaveLength(3);
});

it('shows the last 5 rows on page 3', async () => {
  const { container } = render(<TransactionsTable transactions={rows} />);
  await userEvent.click(screen.getByRole('button', { name: 'Page 3' }));
  expect(bodyRows(container)).toHaveLength(5);
  expect(bodyRows(container)[0].getElement()).toHaveTextContent('2026-07-05');
});

it('sorts by amount when its header is activated', async () => {
  const { container } = render(<TransactionsTable transactions={[tx(1, 5000), tx(2, -9000, 'Cashback'), tx(3, 100)]} />);
  createWrapper(container).findTable()!.findColumnSortingArea(4)!.click();
  // First activation sorts descending, like the old header toggle.
  expect(bodyRows(container).map((r) => r.getElement().textContent)).toEqual([
    expect.stringContaining('Merchant 1'),
    expect.stringContaining('Merchant 3'),
    expect.stringContaining('Merchant 2'),
  ]);
});

it('keeps the columns and shows each category name', () => {
  const { container } = render(<TransactionsTable transactions={[tx(1, -9000, 'Cashback')]} />);
  const headers = createWrapper(container).findTable()!.findColumnHeaders().map((h) => h.getElement().textContent);
  expect(headers).toEqual(['Date', 'Description', 'Category', 'Amount']);
  expect(screen.getByText('Cashback')).toBeVisible();
});
