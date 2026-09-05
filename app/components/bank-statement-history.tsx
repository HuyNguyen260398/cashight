'use client';

import { Button } from '@/components/ui/button';
import type { StatementListItem } from '@/frontend/api/contracts';
import { statementRows } from '@/frontend/lib/statement-history';
import { bankShortName, type BankCode } from '@/lib/banks';
import { StatementsTable } from './statements-table';

export function BankStatementHistory({ items, bank, loading, error, onRetry, onDelete }: {
  items: StatementListItem[];
  bank: BankCode | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const rows = bank ? statementRows(items, bank) : [];
  return (
    <section id="statement-history" aria-labelledby="statement-history-heading" className="scroll-mt-24 space-y-4">
      <div>
        <h2 id="statement-history-heading" className="text-xl font-semibold text-gray-900 dark:text-white/90">
          {bank ? `${bankShortName(bank)} statement history` : 'Statement history'}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">All uploaded months for this bank. Select a month to view its spending.</p>
      </div>
      {error ? (
        <div role="alert" className="surface-card space-y-3 p-5">
          <p className="text-sm text-error-700 dark:text-error-400">Could not refresh statement history: {error}</p>
          <Button variant="outline" onClick={onRetry}>Retry history</Button>
        </div>
      ) : null}
      {loading || bank === null ? (
        <p role="status" className="surface-card p-6 text-sm text-gray-500 dark:text-gray-400">
          {bank === null && !loading ? 'Choose a bank or wait for the spending view to select one.' : 'Loading statement history…'}
        </p>
      ) : rows.length > 0 ? (
        <StatementsTable key={bank} rows={rows} onDelete={onDelete} />
      ) : !error ? (
        <div className="surface-card p-8 text-center">
          <p className="font-medium text-gray-900 dark:text-white/90">No {bankShortName(bank)} statements uploaded yet</p>
          <a className="mt-3 inline-block text-sm font-medium text-brand-500 underline underline-offset-4" href="#statement-upload">Upload a statement</a>
        </div>
      ) : null}
    </section>
  );
}
