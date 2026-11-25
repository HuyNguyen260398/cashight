'use client';

import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
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
    <section id="statement-history" aria-labelledby="statement-history-heading" className="console-anchor">
      <SpaceBetween size="m">
        <Header
          variant="h2"
          headingTagOverride="h2"
          description="All uploaded months for this bank. Select a month to view its spending."
        >
          <span id="statement-history-heading">
            {bank ? `${bankShortName(bank)} statement history` : 'Statement history'}
          </span>
        </Header>
        {error ? (
          <div role="alert">
            <Alert type="error" action={<Button onClick={onRetry}>Retry history</Button>}>
              Could not refresh statement history: {error}
            </Alert>
          </div>
        ) : null}
        {loading || bank === null ? (
          <Container>
            <div role="status">
              {bank === null && !loading ? (
                <Box color="text-body-secondary">Choose a bank or wait for the spending view to select one.</Box>
              ) : (
                <StatusIndicator type="loading">Loading statement history…</StatusIndicator>
              )}
            </div>
          </Container>
        ) : rows.length > 0 ? (
          <StatementsTable key={bank} rows={rows} onDelete={onDelete} />
        ) : !error ? (
          <Container>
            <Box textAlign="center">
              <SpaceBetween size="xs">
                <Box variant="strong">No {bankShortName(bank)} statements uploaded yet</Box>
                <Link href="#statement-upload">Upload a statement</Link>
              </SpaceBetween>
            </Box>
          </Container>
        ) : null}
      </SpaceBetween>
    </section>
  );
}
