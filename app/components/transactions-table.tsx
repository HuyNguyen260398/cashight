'use client';

import { useState } from 'react';
import type { Transaction } from '@/lib/schemas';
import { categoryColor } from '@/lib/category-colors';
import { formatVND } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

type SortKey = 'date' | 'amount';
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

export function TransactionsTable({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' });

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    );
  }

  const sorted = [...transactions].sort((a, b) => {
    let cmp: number;
    if (sort.key === 'date') {
      cmp = a.date.localeCompare(b.date);
    } else {
      cmp = a.amountVnd - b.amountVnd;
    }
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  return (
    <>
      {/* Desktop table — hidden on mobile */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort('date')}
              >
                Date
                <SortIndicator sortKey="date" active={sort.key} dir={sort.dir} />
              </TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => toggleSort('amount')}
              >
                Amount
                <SortIndicator
                  sortKey="amount"
                  active={sort.key}
                  dir={sort.dir}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((t, i) => (
              <TableRow key={`${t.date}-${t.description}-${i}`}>
                <TableCell className="text-muted-foreground">
                  {t.date}
                </TableCell>
                <TableCell className="max-w-xs truncate">
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
                  className={`text-right font-medium tabular-nums ${
                    t.amountVnd < 0 ? 'text-emerald-600' : ''
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
      <div className="flex flex-col gap-3 md:hidden">
        {sorted.map((t, i) => (
          <div
            key={`${t.date}-${t.description}-${i}`}
            className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.description}</p>
                <p className="text-xs text-muted-foreground">{t.date}</p>
              </div>
              <p
                className={`shrink-0 font-semibold tabular-nums ${
                  t.amountVnd < 0 ? 'text-emerald-600' : ''
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
    </>
  );
}
