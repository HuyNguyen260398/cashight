'use client';

import { useMemo, useState } from 'react';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

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
import type {
  CostExplorerComparison,
  CostExplorerCompleteResult,
} from '@/frontend/api/contracts';
import { cn } from '@/lib/utils';
import {
  decimalNumber,
  displayGroupValues,
  displayGroupedLabel,
  formatCostValue,
  formatPeriodLabel,
  percentageFromDifference,
} from './cost-format';

const PAGE_SIZE = 10;
type SortKey = 'group' | 'total';
type SortDirection = 'asc' | 'desc';

interface StandardRow {
  id: string;
  kind: 'standard';
  label: string;
  values: string[];
  total: string;
  estimated: boolean;
}

interface ComparisonRow {
  id: string;
  kind: 'comparison';
  label: string;
  baseline: string;
  comparison: string;
  difference: string;
  unit: string;
}

type BreakdownRow = StandardRow | ComparisonRow;

function rowTotal(row: BreakdownRow): number {
  return decimalNumber(row.kind === 'standard' ? row.total : row.difference);
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  const Icon = active
    ? direction === 'asc'
      ? ArrowUp
      : ArrowDown
    : ChevronsUpDown;
  return (
    <button
      type="button"
      className="inline-flex min-h-11 items-center gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`Sort by ${label}`}
      onClick={onClick}
    >
      {label}
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

export function CostBreakdown({
  request,
  result,
  comparison,
}: {
  request: CostExplorerReportRequest;
  result: CostExplorerCompleteResult | null;
  comparison: CostExplorerComparison | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('group');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const comparisonMetricName = comparison
    ? Object.keys(comparison.total)[0]
    : undefined;
  const unit =
    result?.currencyOrUnit ??
    (comparisonMetricName ? comparison?.total[comparisonMetricName]?.unit : undefined) ??
    'USD';

  const rows = useMemo<BreakdownRow[]>(() => {
    if (comparison && comparisonMetricName) {
      return comparison.comparisons.map((row, index) => {
        const metric = row.metrics[comparisonMetricName];
        return {
          id: `comparison-${index}`,
          kind: 'comparison',
          label: displayGroupValues(row.groupValues, request.groupBy),
          baseline: metric?.baseline ?? '0',
          comparison: metric?.comparison ?? '0',
          difference: metric?.difference ?? '0',
          unit: metric?.unit ?? unit,
        };
      });
    }
    return (result?.breakdown ?? []).map((row, index) => ({
      id: `standard-${index}`,
      kind: 'standard',
      label: displayGroupValues(row.groupValues, request.groupBy),
      values: row.values,
      total: row.total,
      estimated: row.estimated,
    }));
  }, [comparison, comparisonMetricName, request.groupBy, result, unit]);

  const sortedRows = useMemo(
    () =>
      [...rows].sort((left, right) => {
        const comparisonValue =
          sortKey === 'group'
            ? left.label.localeCompare(right.label, undefined, {
                numeric: true,
                sensitivity: 'base',
              })
            : rowTotal(left) - rowTotal(right);
        const directed = sortDirection === 'asc' ? comparisonValue : -comparisonValue;
        return directed || left.label.localeCompare(right.label, undefined, { numeric: true });
      }),
    [rows, sortDirection, sortKey],
  );
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = sortedRows.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const sortBy = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(nextKey);
      setSortDirection(nextKey === 'total' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="border-b border-gray-100 dark:border-gray-800">
        <CardTitle>
          <h2>Cost and usage breakdown</h2>
        </CardTitle>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Complete grouped results. Values retain AWS precision in CSV exports.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500 dark:text-gray-400 md:px-6">
            No breakdown rows for this report.
          </p>
        ) : (
          <>
            <div
              data-testid="desktop-cost-breakdown"
              className="cost-breakdown-scroll hidden max-h-[36rem] overflow-auto md:block"
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white dark:bg-gray-950">
                  <TableRow>
                    <TableHead
                      aria-sort={
                        sortKey === 'group'
                          ? sortDirection === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <SortButton
                        label="Group"
                        active={sortKey === 'group'}
                        direction={sortDirection}
                        onClick={() => sortBy('group')}
                      />
                    </TableHead>
                    {comparison ? (
                      <>
                        <TableHead className="text-right">Baseline</TableHead>
                        <TableHead className="text-right">Comparison</TableHead>
                        <TableHead
                          className="text-right"
                          aria-sort={
                            sortKey === 'total'
                              ? sortDirection === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                        >
                          <SortButton
                            label="Difference"
                            active={sortKey === 'total'}
                            direction={sortDirection}
                            onClick={() => sortBy('total')}
                          />
                        </TableHead>
                      </>
                    ) : (
                      <>
                        {result?.periods.map((period) => (
                          <TableHead key={period.start} className="text-right">
                            {formatPeriodLabel(period.start, request.granularity)}
                            {period.estimated ? (
                              <span className="ml-1 normal-case text-warning-700 dark:text-warning-400">
                                est.
                              </span>
                            ) : null}
                          </TableHead>
                        ))}
                        <TableHead
                          className="text-right"
                          aria-sort={
                            sortKey === 'total'
                              ? sortDirection === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                        >
                          <SortButton
                            label="Total"
                            active={sortKey === 'total'}
                            direction={sortDirection}
                            onClick={() => sortBy('total')}
                          />
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-64 whitespace-normal font-medium text-gray-900 dark:text-white/90">
                        {row.label || 'Total'}
                        {row.kind === 'standard' && row.estimated ? (
                          <span className="ml-2 text-xs font-normal text-warning-700 dark:text-warning-400">
                            Estimated
                          </span>
                        ) : null}
                      </TableCell>
                      {row.kind === 'comparison' ? (
                        <>
                          <TableCell className="text-right tabular-nums">
                            {formatCostValue(row.baseline, row.unit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCostValue(row.comparison, row.unit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCostValue(row.difference, row.unit, {
                              signDisplay: 'exceptZero',
                            })}
                            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                              {percentageFromDifference(row.baseline, row.difference) ?? '—'}
                            </span>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          {result?.periods.map((period, index) => (
                            <TableCell
                              key={period.start}
                              className="text-right tabular-nums"
                            >
                              {formatCostValue(row.values[index] ?? '0', unit)}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-semibold tabular-nums text-gray-900 dark:text-white/90">
                            {formatCostValue(row.total, unit)}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3 p-4 md:hidden">
              <div className="flex items-center justify-between gap-3">
                <SortButton
                  label="Group"
                  active={sortKey === 'group'}
                  direction={sortDirection}
                  onClick={() => sortBy('group')}
                />
                <SortButton
                  label={comparison ? 'Difference' : 'Total'}
                  active={sortKey === 'total'}
                  direction={sortDirection}
                  onClick={() => sortBy('total')}
                />
              </div>
              {visibleRows.map((row) => (
                <article
                  key={`mobile-${row.id}`}
                  className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
                >
                  <h3 className="font-medium text-gray-900 dark:text-white/90">
                    {row.label || 'Total'}
                  </h3>
                  {row.kind === 'comparison' ? (
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      {[
                        ['Baseline', formatCostValue(row.baseline, row.unit)],
                        ['Comparison', formatCostValue(row.comparison, row.unit)],
                        [
                          'Difference',
                          `${formatCostValue(row.difference, row.unit, { signDisplay: 'exceptZero' })} ${percentageFromDifference(row.baseline, row.difference) ?? ''}`,
                        ],
                      ].map(([term, value]) => (
                        <div key={term} className={cn(term === 'Difference' && 'col-span-2')}>
                          <dt className="text-xs text-gray-500 dark:text-gray-400">{term}</dt>
                          <dd className="mt-0.5 tabular-nums text-gray-700 dark:text-gray-300">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <dl className="mt-3 space-y-2 text-sm">
                      {result?.periods.map((period, index) => (
                        <div key={period.start} className="flex justify-between gap-4">
                          <dt className="text-gray-500 dark:text-gray-400">
                            {formatPeriodLabel(period.start, request.granularity)}
                          </dt>
                          <dd className="tabular-nums text-gray-700 dark:text-gray-300">
                            {formatCostValue(row.values[index] ?? '0', unit)}
                          </dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-4 border-t border-gray-100 pt-2 font-semibold dark:border-gray-800">
                        <dt>Total</dt>
                        <dd className="tabular-nums">{formatCostValue(row.total, unit)}</dd>
                      </div>
                    </dl>
                  )}
                </article>
              ))}
            </div>

            <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} />
          </>
        )}

        {comparison?.drivers.length ? (
          <section className="border-t border-gray-100 px-5 py-5 dark:border-gray-800 md:px-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white/90">
              Cost drivers
            </h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {comparison.drivers.map((driver, index) => {
                const metric = comparisonMetricName
                  ? driver.metrics[comparisonMetricName]
                  : undefined;
                return (
                  <li
                    key={`driver-${index}`}
                    className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/[0.03]"
                  >
                    <p className="font-medium text-gray-800 dark:text-gray-200">
                      {driver.name
                        ? displayGroupedLabel(driver.name, request.groupBy)
                        : displayGroupValues(driver.groupValues, request.groupBy)}
                    </p>
                    {metric ? (
                      <p className="mt-1 tabular-nums text-gray-500 dark:text-gray-400">
                        {formatCostValue(metric.difference, metric.unit, {
                          signDisplay: 'exceptZero',
                        })}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
