'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ChevronsUpDown, Trash2 } from 'lucide-react';

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
  if (sortKey !== active) {
    return <ChevronsUpDown className="ml-1 size-3 opacity-30" aria-hidden />;
  }
  return dir === 'asc' ? (
    <ArrowUp className="ml-1 size-3" aria-hidden />
  ) : (
    <ArrowDown className="ml-1 size-3" aria-hidden />
  );
}

export function StatementsTable({
  rows,
  onDelete,
}: {
  rows: StatementRow[];
  onDelete?: (key: string) => Promise<void>;
}) {
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
      if (onDelete) {
        // Delegated to parent — parent manages state and toasts.
        await onDelete(row.key);
        setOpenKey(null);
      } else {
        // Fallback: call the Lambda API directly and refresh the route cache.
        const { apiFetch } = await import('@/frontend/api/client');
        const { getPublicConfig } = await import('@/frontend/auth/config');
        const config = getPublicConfig();
        await apiFetch(
          `${config.apiBaseUrl}/statements/${encodeURIComponent(row.key)}`,
          { method: 'DELETE' },
        );
        setOpenKey(null);
        toast.success('Statement deleted');
        router.refresh();
      }
    } catch {
      toast.error('Could not delete statement');
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Card</TableHead>
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => toggleSort('period')}
            >
              <span className="inline-flex items-center">
                Period
                <SortIndicator
                  sortKey="period"
                  active={sort.key}
                  dir={sort.dir}
                />
              </span>
            </TableHead>
            <TableHead
              className="cursor-pointer select-none text-right"
              onClick={() => toggleSort('totalSpend')}
            >
              <span className="inline-flex items-center justify-end">
                Total spend
                <SortIndicator
                  sortKey="totalSpend"
                  active={sort.key}
                  dir={sort.dir}
                />
              </span>
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
                    className="font-medium text-brand-500 underline-offset-4 hover:underline dark:text-brand-400"
                  >
                    {row.year}-{mm}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-gray-900 dark:text-white/90">
                  {formatVND(row.totalSpend)}
                </TableCell>
                <TableCell className="text-gray-500 dark:text-gray-400">
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
                        <Trash2 className="size-4" aria-hidden />
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
