'use client';

import { useCollection } from '@cloudscape-design/collection-hooks';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import type { Transaction } from '@/lib/schemas';
import { formatVND } from '@/lib/format';
import { CategoryLabel } from './category-label';
import { PAGINATION_LABELS } from './table-labels';
import { descendingFirst } from './table-sorting';

const PAGE_SIZE = 10;

const COLUMNS: TableProps.ColumnDefinition<Transaction>[] = [
  { id: 'date', header: 'Date', cell: (t) => t.date, sortingField: 'date' },
  { id: 'description', header: 'Description', cell: (t) => t.description },
  { id: 'category', header: 'Category', cell: (t) => <CategoryLabel category={t.category} />, sortingField: 'category' },
  {
    id: 'amount',
    header: 'Amount',
    // Credits (negative) read as money coming back.
    cell: (t) => (
      <Box textAlign="right" fontWeight="bold" color={t.amountVnd < 0 ? 'text-status-success' : 'inherit'}>
        {formatVND(t.amountVnd)}
      </Box>
    ),
    sortingField: 'amountVnd',
  },
];

export function TransactionsTable({ transactions }: { transactions: Transaction[] }) {
  const { items, collectionProps, paginationProps, actions } = useCollection(transactions, {
    sorting: { defaultState: { sortingColumn: COLUMNS[0], isDescending: true } },
    pagination: { pageSize: PAGE_SIZE },
  });

  return (
    <Table
      {...collectionProps}
      variant="container"
      columnDefinitions={COLUMNS}
      items={items}
      onSortingChange={descendingFirst(collectionProps.sortingColumn, actions.setSorting)}
      header={<Header description="Recent statement lines for the selected period.">Transactions</Header>}
      pagination={<Pagination {...paginationProps} ariaLabels={PAGINATION_LABELS} />}
      empty={<Box textAlign="center" color="inherit">No transactions in this period</Box>}
    />
  );
}
