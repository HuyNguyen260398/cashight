'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { Transaction } from '@/lib/schemas';
import { categoryColor } from '@/lib/category-colors';
import { formatVND } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

type SortKey = 'date' | 'amount' | 'category';
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
  return (
    <span className="ml-1 inline-flex">
      {dir === 'asc' ? (
        <ArrowUp className="size-3" aria-hidden />
      ) : (
        <ArrowDown className="size-3" aria-hidden />
      )}
    </span>
  );
}

export function TransactionsTable({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const PAGE_SIZE = 10;
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    );
    setPage(1);
  }

  const sorted = [...transactions].sort((a, b) => {
    let cmp: number;
    if (sort.key === 'date') {
      cmp = a.date.localeCompare(b.date);
    } else if (sort.key === 'category') {
      cmp = a.category.localeCompare(b.category);
    } else {
      cmp = a.amountVnd - b.amountVnd;
    }
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Derive the clamped page rather than storing an out-of-range value, so a
  // delete/period switch that shrinks the data never strands an empty page.
  const currentPage = Math.min(page, pageCount);
  const paged = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div>
      {/* Desktop table — hidden on mobile */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort('date')}
              >
                <span className="inline-flex items-center">
                  Date
                  {sort.key === 'date' ? (
                    <SortIndicator sortKey="date" active={sort.key} dir={sort.dir} />
                  ) : (
                    <ChevronsUpDown className="ml-1 size-3 opacity-30" aria-hidden />
                  )}
                </span>
              </TableHead>
              <TableHead>Description</TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort('category')}
              >
                <span className="inline-flex items-center">
                  Category
                  {sort.key === 'category' ? (
                    <SortIndicator
                      sortKey="category"
                      active={sort.key}
                      dir={sort.dir}
                    />
                  ) : (
                    <ChevronsUpDown className="ml-1 size-3 opacity-30" aria-hidden />
                  )}
                </span>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => toggleSort('amount')}
              >
                <span className="inline-flex items-center justify-end">
                  Amount
                  {sort.key === 'amount' ? (
                    <SortIndicator
                      sortKey="amount"
                      active={sort.key}
                      dir={sort.dir}
                    />
                  ) : (
                    <ChevronsUpDown className="ml-1 size-3 opacity-30" aria-hidden />
                  )}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((t, i) => (
              <TableRow key={`${t.date}-${t.description}-${i}`}>
                <TableCell className="text-gray-500 dark:text-gray-400">
                  {t.date}
                </TableCell>
                <TableCell className="max-w-xs truncate font-medium text-gray-800 dark:text-white/90">
                  {t.description}
                </TableCell>
                <TableCell>
                  <Badge
                    style={{
                      backgroundColor: categoryColor(t.category),
                      color: '#fff',
                    }}
                  >
                    {t.category}
                  </Badge>
                </TableCell>
                <TableCell
                  className={`text-right font-semibold tabular-nums ${
                    t.amountVnd < 0
                      ? 'text-success-700 dark:text-success-500'
                      : 'text-gray-900 dark:text-white/90'
                  }`}
                >
                  {formatVND(t.amountVnd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list — hidden on md+ */}
      <div className="flex flex-col gap-3 p-4 md:hidden">
        {paged.map((t, i) => (
          <div
            key={`${t.date}-${t.description}-${i}`}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900 dark:text-white/90">
                  {t.description}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t.date}</p>
              </div>
              <p
                className={`shrink-0 font-semibold tabular-nums ${
                  t.amountVnd < 0
                    ? 'text-success-700 dark:text-success-500'
                    : 'text-gray-900 dark:text-white/90'
                }`}
              >
                {formatVND(t.amountVnd)}
              </p>
            </div>
            <div className="mt-2">
              <Badge
                style={{
                  backgroundColor: categoryColor(t.category),
                  color: '#fff',
                }}
              >
                {t.category}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      <Pagination
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
      />
    </div>
  );
}
