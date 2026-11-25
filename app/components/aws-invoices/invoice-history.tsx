'use client';

import { useState } from 'react';
import type { YearMonth } from '@cashight/domain/aws-invoices';
import { notify } from '@/app/components/console/notifications';

import type { AwsInvoiceListItem } from '@/frontend/api/contracts';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { formatInvoiceDate, formatInvoiceMoney, formatInvoiceMonth } from './invoice-format';

export function InvoiceHistory({
  items,
  selectedYearMonth,
  onSelect,
  onDelete,
}: {
  items: AwsInvoiceListItem[];
  selectedYearMonth: YearMonth | null;
  onSelect: (yearMonth: YearMonth) => void;
  onDelete: (yearMonth: YearMonth) => Promise<void>;
}) {
  const [openMonth, setOpenMonth] = useState<AwsInvoiceListItem | null>(null);
  const [deletingMonth, setDeletingMonth] = useState<YearMonth | null>(null);
  const sorted = [...items].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  async function deleteMonth(yearMonth: YearMonth) {
    setDeletingMonth(yearMonth);
    try {
      await onDelete(yearMonth);
      setOpenMonth(null);
    } catch {
      notify({ type: 'error', content: 'Could not delete invoice' });
    } finally {
      setDeletingMonth(null);
    }
  }

  const right = (content: React.ReactNode, bold = false) => (
    <Box textAlign="right" fontWeight={bold ? 'bold' : 'normal'}>
      {content}
    </Box>
  );
  const columns: TableProps.ColumnDefinition<AwsInvoiceListItem>[] = [
    {
      id: 'month',
      header: 'Month',
      // The month on screen keeps the old row's aria-current cue, as a badge.
      cell: (item) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Box fontWeight="bold">{formatInvoiceMonth(item.yearMonth)}</Box>
          {item.yearMonth === selectedYearMonth ? (
            <span aria-current="true">
              <Badge color="blue">Viewing</Badge>
            </span>
          ) : null}
        </SpaceBetween>
      ),
    },
    { id: 'total', header: 'Total', cell: (item) => right(formatInvoiceMoney(item.amountDue, item.currency), true) },
    { id: 'tax', header: 'Tax', cell: (item) => right(formatInvoiceMoney(item.tax, item.currency)) },
    { id: 'services', header: 'Services', cell: (item) => right(item.serviceCount) },
    { id: 'accounts', header: 'Accounts', cell: (item) => right(item.linkedAccountCount) },
    { id: 'uploaded', header: 'Uploaded', cell: (item) => formatInvoiceDate(item.uploadedAt) },
    {
      id: 'actions',
      header: 'Actions',
      cell: (item) => {
        const label = formatInvoiceMonth(item.yearMonth);
        return (
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="search" ariaLabel={`View ${label}`} onClick={() => onSelect(item.yearMonth)}>
              View
            </Button>
            <Button
              iconName="remove"
              ariaLabel={`Delete ${label}`}
              disabled={deletingMonth === item.yearMonth}
              onClick={() => setOpenMonth(item)}
            >
              Delete
            </Button>
          </SpaceBetween>
        );
      },
    },
  ];
  const pendingLabel = openMonth ? formatInvoiceMonth(openMonth.yearMonth) : '';
  const deleting = openMonth !== null && deletingMonth === openMonth.yearMonth;

  return (
    <>
      <Table
        variant="container"
        header={<Header variant="h2">Invoice history</Header>}
        columnDefinitions={columns}
        items={sorted}
        trackBy="yearMonth"
        empty={<Box textAlign="center" color="inherit">No invoice history yet</Box>}
        ariaLabels={{ tableLabel: 'Invoice history' }}
      />
      {openMonth ? (
        <Modal
          visible
          closeAriaLabel="Close"
          onDismiss={() => {
            if (!deleting) setOpenMonth(null);
          }}
          header={`Delete ${pendingLabel} invoice?`}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" disabled={deleting} onClick={() => setOpenMonth(null)}>
                  Cancel
                </Button>
                <Button variant="primary" loading={deleting} onClick={() => void deleteMonth(openMonth.yearMonth)}>
                  {deleting ? 'Deleting…' : 'Delete invoice'}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          This removes the current dashboard record. A previous S3 version remains recoverable for 90 days.
        </Modal>
      ) : null}
    </>
  );
}
