'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { shouldHandleClientSide } from '@/app/components/console/follow';
import { notify } from '@/app/components/console/notifications';
import { formatVND, formatDate } from '@/lib/format';
import { statementDashboardHref } from '@/frontend/lib/dashboard-routes';
import { bankShortName, type BankCode } from '@/lib/banks';
import { PAGINATION_LABELS } from './table-labels';
import { descendingFirst } from './table-sorting';

export type StatementRow = {
  key: string;
  cardLast4: string;
  bank: BankCode;
  year: number;
  month: number;
  totalSpend: number;
  uploadedAt: string | null;
};

const PAGE_SIZE = 12;

const period = (row: StatementRow) => `${row.year}-${String(row.month).padStart(2, '0')}`;

export function StatementsTable({
  rows,
  onDelete,
}: {
  rows: StatementRow[];
  onDelete?: (key: string) => Promise<void>;
}) {
  const router = useRouter();
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [pending, setPending] = useState<StatementRow | null>(null);

  async function handleDelete(row: StatementRow) {
    setDeletingKey(row.key);
    try {
      if (onDelete) {
        await onDelete(row.key);
        setPending(null);
      } else {
        const { apiFetch } = await import('@/frontend/api/client');
        const { getPublicConfig } = await import('@/frontend/auth/config');
        const config = getPublicConfig();
        await apiFetch(`${config.apiBaseUrl}/statements/${encodeURIComponent(row.key)}`, { method: 'DELETE' });
        setPending(null);
        notify({ type: 'success', content: 'Statement deleted' });
        router.refresh();
      }
    } catch {
      notify({ type: 'error', content: 'Could not delete statement' });
    } finally {
      setDeletingKey(null);
    }
  }

  const columns: TableProps.ColumnDefinition<StatementRow>[] = [
    { id: 'bank', header: 'Bank', cell: (row) => <Badge>{bankShortName(row.bank)}</Badge> },
    { id: 'card', header: 'Card', cell: (row) => <Badge color="grey">****{row.cardLast4}</Badge> },
    {
      id: 'period',
      header: 'Period',
      cell: (row) => {
        const href = statementDashboardHref(row);
        return (
          <Link
            href={href}
            onFollow={(event) => {
              if (!shouldHandleClientSide({ detail: event.detail })) return;
              event.preventDefault();
              router.push(href);
            }}
          >
            {period(row)}
          </Link>
        );
      },
      sortingComparator: (a, b) => a.year - b.year || a.month - b.month,
    },
    {
      id: 'totalSpend',
      header: 'Total spend',
      cell: (row) => <Box textAlign="right" fontWeight="bold">{formatVND(row.totalSpend)}</Box>,
      sortingField: 'totalSpend',
    },
    { id: 'uploaded', header: 'Uploaded', cell: (row) => (row.uploadedAt ? formatDate(row.uploadedAt) : '—') },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <Button iconName="remove" disabled={deletingKey === row.key} onClick={() => setPending(row)}>
          Delete
        </Button>
      ),
    },
  ];

  const { items, collectionProps, paginationProps, actions } = useCollection(rows, {
    sorting: { defaultState: { sortingColumn: columns[2], isDescending: true } },
    pagination: { pageSize: PAGE_SIZE },
  });

  const isDeleting = pending !== null && deletingKey === pending.key;

  return (
    <>
      <Table
        {...collectionProps}
        onSortingChange={descendingFirst(collectionProps.sortingColumn, actions.setSorting)}
        variant="container"
        columnDefinitions={columns}
        items={items}
        trackBy="key"
        pagination={<Pagination {...paginationProps} ariaLabels={PAGINATION_LABELS} />}
      />
      {pending ? (
      <Modal
        visible
        onDismiss={() => {
          if (!isDeleting) setPending(null);
        }}
        header="Delete this statement?"
        closeAriaLabel="Close"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" disabled={isDeleting} onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button variant="primary" loading={isDeleting} onClick={() => void handleDelete(pending)}>
                {isDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        This permanently deletes the {period(pending)} statement for ****{pending.cardLast4}. The previous S3
        version is retained for 90 days.
      </Modal>
      ) : null}
    </>
  );
}
