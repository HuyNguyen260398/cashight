'use client';

import { useState } from 'react';
import type { AwsInvoiceService } from '@cashight/domain/aws-invoices';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatInvoiceMoney } from './invoice-format';

type SortKey = 'name' | 'charges' | 'tax' | 'total';
type SortDirection = 'asc' | 'desc';
const PAGE_SIZE = 10;

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ChevronsUpDown className="size-3 opacity-40" aria-hidden />;
  return direction === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />;
}

export function InvoiceServicesTable({
  services,
  currency,
}: {
  services: AwsInvoiceService[];
  currency: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);

  function toggleSort(nextKey: SortKey) {
    setDirection((current) =>
      nextKey === sortKey ? (current === 'asc' ? 'desc' : 'asc') : nextKey === 'name' ? 'asc' : 'desc',
    );
    setSortKey(nextKey);
    setPage(1);
  }

  const sorted = [...services].sort((a, b) => {
    const comparison = sortKey === 'name' ? a.name.localeCompare(b.name) : a[sortKey] - b[sortKey] || a.name.localeCompare(b.name);
    return direction === 'asc' ? comparison : -comparison;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <Card className="gap-4 overflow-hidden py-0">
      <CardHeader className="pt-5 md:pt-6">
        <CardTitle>Service details</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {services.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-gray-500 dark:text-gray-400 md:px-6">No billed service data</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {([
                    ['name', 'Service'],
                    ['charges', 'Charges'],
                    ['tax', 'Tax'],
                    ['total', 'Total'],
                  ] as const).map(([key, label]) => (
                    <TableHead key={key} className={key === 'name' ? '' : 'text-right'}>
                      <Button variant="ghost" size="sm" className="min-h-11 gap-1 px-1" aria-label={`Sort by ${label.toLowerCase()}`} onClick={() => toggleSort(key)}>
                        {label}<SortIcon active={sortKey === key} direction={direction} />
                      </Button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody data-testid="invoice-services-body">
                {visible.map((service) => (
                  <TableRow key={service.name}>
                    <TableCell className="max-w-64 truncate font-medium text-gray-900 dark:text-white/90">{service.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInvoiceMoney(service.charges, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInvoiceMoney(service.tax, currency)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatInvoiceMoney(service.total, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
