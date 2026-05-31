'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatVND, formatDate } from '@/lib/format';

export type StatementRow = {
  key: string;
  cardLast4: string;
  year: number;
  month: number;
  totalSpend: number;
  uploadedAt: string | null;
};

export function StatementsTable({ rows }: { rows: StatementRow[] }) {
  const router = useRouter();
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  async function handleDelete(row: StatementRow) {
    setDeletingKey(row.key);
    try {
      const res = await fetch(
        '/api/statements/' + encodeURIComponent(row.key),
        { method: 'DELETE' },
      );
      if (res.ok) {
        toast.success('Statement deleted');
        router.refresh();
      } else {
        let message = 'Could not delete statement';
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // response had no JSON body — keep the default message
        }
        toast.error(message);
      }
    } catch {
      toast.error('Could not delete statement');
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Card</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Total spend</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const mm = String(row.month).padStart(2, '0');
            const isDeleting = deletingKey === row.key;
            return (
              <TableRow key={row.key}>
                <TableCell>
                  <Badge variant="secondary">****{row.cardLast4}</Badge>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/?period=month&year=${row.year}&month=${row.month}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {row.year}-{mm}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatVND(row.totalSpend)}
                </TableCell>
                <TableCell>
                  {row.uploadedAt ? formatDate(row.uploadedAt) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isDeleting}
                      >
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete this statement?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes the {row.year}-{mm} statement
                          for ****{row.cardLast4}. The previous S3 version is
                          retained for 90 days.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white hover:bg-destructive/90"
                          disabled={isDeleting}
                          onClick={(e) => {
                            e.preventDefault();
                            handleDelete(row);
                          }}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
