'use client';

import { useState } from 'react';
import type { YearMonth } from '@cashight/domain/aws-invoices';
import { Eye, Loader2, Trash2 } from 'lucide-react';

import type { AwsInvoiceListItem } from '@/frontend/api/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  const [openMonth, setOpenMonth] = useState<YearMonth | null>(null);
  const [deletingMonth, setDeletingMonth] = useState<YearMonth | null>(null);
  const sorted = [...items].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  async function deleteMonth(yearMonth: YearMonth) {
    setDeletingMonth(yearMonth);
    try {
      await onDelete(yearMonth);
      setOpenMonth(null);
    } finally {
      setDeletingMonth(null);
    }
  }

  return (
    <Card className="gap-4 overflow-hidden py-0">
      <CardHeader className="pt-5 md:pt-6"><CardTitle>Invoice history</CardTitle></CardHeader>
      <CardContent className="px-0">
        {sorted.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-gray-500 dark:text-gray-400 md:px-6">No invoice history yet</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Services</TableHead><TableHead className="text-right">Accounts</TableHead><TableHead>Uploaded</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {sorted.map((item) => {
                const label = formatInvoiceMonth(item.yearMonth);
                const deleting = deletingMonth === item.yearMonth;
                return (
                  <TableRow key={item.yearMonth} aria-current={selectedYearMonth === item.yearMonth ? 'true' : undefined}>
                    <TableCell className="font-medium text-gray-900 dark:text-white/90">{label}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatInvoiceMoney(item.amountDue, item.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInvoiceMoney(item.tax, item.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.serviceCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.linkedAccountCount}</TableCell>
                    <TableCell>{formatInvoiceDate(item.uploadedAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" className="min-h-11" aria-label={`View ${label}`} onClick={() => onSelect(item.yearMonth)}><Eye className="size-4" aria-hidden />View</Button>
                        <AlertDialog open={openMonth === item.yearMonth} onOpenChange={(open) => setOpenMonth(open ? item.yearMonth : null)}>
                          <AlertDialogTrigger asChild><Button variant="destructive" size="sm" className="min-h-11" aria-label={`Delete ${label}`}><Trash2 className="size-4" aria-hidden />Delete</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Delete {label} invoice?</AlertDialogTitle><AlertDialogDescription>This removes the current dashboard record. A previous S3 version remains recoverable for 90 days.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction className={buttonVariants({ variant: 'destructive' })} disabled={deleting} onClick={(event) => { event.preventDefault(); void deleteMonth(item.yearMonth); }}>{deleting ? <><Loader2 className="size-4 animate-spin" aria-hidden />Deleting…</> : 'Delete invoice'}</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
