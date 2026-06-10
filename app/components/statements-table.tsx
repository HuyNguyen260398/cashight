'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
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

type SortKey = 'period' | 'totalSpend';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

function SortIndicator({
  sortKey,
  active,
  dir,
}: {
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
}) {
  if (sortKey !== active) return <span className="ml-1 opacity-30">↕</span>;
  return <span className="ml-1">{dir === 'asc' ? '▲' : '▼'}</span>;
}

export function StatementsTable({ rows }: { rows: StatementRow[] }) {
  const router = useRouter();
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'period', dir: 'desc' });
  const PAGE_SIZE = 12;
  const [page, setPage] = useState(1);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    );
    setPage(1);
  }

  const sorted = [...rows].sort((a, b) => {
    const cmp =
      sort.key === 'period'
        ? a.year - b.year || a.month - b.month
        : a.totalSpend - b.totalSpend;
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Derive the clamped page rather than storing an out-of-range value, so a
  // delete that shrinks the data (via router.refresh()) never strands an
  // empty page.
  const currentPage = Math.min(page, pageCount);
  const paged = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  async function handleDelete(row: StatementRow) {
    setDeletingKey(row.key);
    try {
      const res = await fetch(
        '/api/statements/' + encodeURIComponent(row.key),
        { method: 'DELETE' },
      );
      if (res.ok) {
        // Close the dialog immediately; router.refresh() then drops the row.
        setOpenKey(null);
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
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => toggleSort('period')}
            >
              Period
              <SortIndicator
                sortKey="period"
                active={sort.key}
                dir={sort.dir}
              />
            </TableHead>
            <TableHead
              className="cursor-pointer select-none text-right"
              onClick={() => toggleSort('totalSpend')}
            >
              Total spend
              <SortIndicator
                sortKey="totalSpend"
                active={sort.key}
                dir={sort.dir}
              />
            </TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.map((row) => {
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
                  <AlertDialog
                    open={openKey === row.key}
                    onOpenChange={(o) => setOpenKey(o ? row.key : null)}
                  >
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
                          className={buttonVariants({ variant: 'destructive' })}
                          disabled={isDeleting}
                          onClick={(e) => {
                            e.preventDefault();
                            handleDelete(row);
                          }}
                        >
                          {isDeleting ? 'Deleting…' : 'Delete'}
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
      <Pagination
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
      />
    </div>
  );
}
