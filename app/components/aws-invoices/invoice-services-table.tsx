'use client';

import { useMemo } from 'react';
import type { AwsInvoiceService } from '@cashight/domain/aws-invoices';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import { PAGINATION_LABELS } from '@/app/components/table-labels';
import { formatInvoiceMoney } from './invoice-format';

const PAGE_SIZE = 10;

const byName = (a: AwsInvoiceService, b: AwsInvoiceService) => a.name.localeCompare(b.name);
const byNumber = (key: 'charges' | 'tax' | 'total') => (a: AwsInvoiceService, b: AwsInvoiceService) =>
  a[key] - b[key] || a.name.localeCompare(b.name);

export function InvoiceServicesTable({
  services,
  currency,
}: {
  services: AwsInvoiceService[];
  currency: string;
}) {
  const columns = useMemo<TableProps.ColumnDefinition<AwsInvoiceService>[]>(() => {
    const money = (key: 'charges' | 'tax' | 'total', label: string, bold = false): TableProps.ColumnDefinition<AwsInvoiceService> => ({
      id: key,
      header: label,
      ariaLabel: () => `Sort by ${label.toLowerCase()}`,
      sortingComparator: byNumber(key),
      cell: (service) => (
        <Box textAlign="right" fontWeight={bold ? 'bold' : 'normal'}>
          {formatInvoiceMoney(service[key], currency)}
        </Box>
      ),
    });
    return [
      { id: 'name', header: 'Service', ariaLabel: () => 'Sort by service', sortingComparator: byName, cell: (service) => service.name },
      money('charges', 'Charges'),
      money('tax', 'Tax'),
      money('total', 'Total', true),
    ];
  }, [currency]);

  const { items, collectionProps, paginationProps, actions } = useCollection(services, {
    sorting: { defaultState: { sortingColumn: columns[3], isDescending: true } },
    pagination: { pageSize: PAGE_SIZE },
  });

  return (
    <Table
      {...collectionProps}
      // Service sorts A→Z first; amounts start largest-first.
      onSortingChange={({ detail }) => {
        const same = detail.sortingColumn.sortingComparator === collectionProps.sortingColumn?.sortingComparator;
        actions.setSorting({
          sortingColumn: detail.sortingColumn,
          isDescending: same ? detail.isDescending : detail.sortingColumn.sortingComparator !== byName,
        });
      }}
      variant="container"
      columnDefinitions={columns}
      items={items}
      trackBy="name"
      header={<Header variant="h2">Service details</Header>}
      empty={<Box textAlign="center" color="inherit">No billed service data</Box>}
      pagination={services.length ? <Pagination {...paginationProps} ariaLabels={PAGINATION_LABELS} /> : undefined}
    />
  );
}
