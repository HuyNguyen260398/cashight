'use client';

import { useMemo, useState } from 'react';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import type {
  CostExplorerComparison,
  CostExplorerCompleteResult,
} from '@/frontend/api/contracts';
import { PAGINATION_LABELS } from '@/app/components/table-labels';
import {
  decimalNumber,
  displayGroupValues,
  displayGroupedLabel,
  formatCostValue,
  formatPeriodLabel,
  percentageFromDifference,
} from './cost-format';

const PAGE_SIZE = 10;

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

const byLabel = (left: BreakdownRow, right: BreakdownRow) =>
  left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' });
const byTotal = (left: BreakdownRow, right: BreakdownRow) =>
  rowTotal(left) - rowTotal(right) || left.label.localeCompare(right.label, undefined, { numeric: true });

const sortLabel = (label: string) => () => `Sort by ${label}`;

export function CostBreakdown({
  request,
  result,
  comparison,
  onExportCsv,
}: {
  request: CostExplorerReportRequest;
  result: CostExplorerCompleteResult | null;
  comparison: CostExplorerComparison | null;
  /** Omit to render the panel without the CSV export action. */
  onExportCsv?: () => Promise<void>;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
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

  const columns = useMemo<TableProps.ColumnDefinition<BreakdownRow>[]>(() => {
    const group: TableProps.ColumnDefinition<BreakdownRow> = {
      id: 'group',
      header: 'Group',
      ariaLabel: sortLabel('Group'),
      sortingComparator: byLabel,
      cell: (row) => (
        <>
          {row.label || 'Total'}
          {row.kind === 'standard' && row.estimated ? (
            <Box variant="small" color="text-status-warning" display="inline-block" margin={{ left: 'xs' }}>
              Estimated
            </Box>
          ) : null}
        </>
      ),
    };
    if (comparison) {
      return [
        group,
        { id: 'baseline', header: 'Baseline', cell: (row) => row.kind === 'comparison' && formatCostValue(row.baseline, row.unit) },
        { id: 'comparison', header: 'Comparison', cell: (row) => row.kind === 'comparison' && formatCostValue(row.comparison, row.unit) },
        {
          id: 'total',
          header: 'Difference',
          ariaLabel: sortLabel('Difference'),
          sortingComparator: byTotal,
          cell: (row) =>
            row.kind === 'comparison' && (
              <>
                {formatCostValue(row.difference, row.unit, { signDisplay: 'exceptZero' })}{' '}
                <Box variant="small" color="text-body-secondary" display="inline-block">
                  {percentageFromDifference(row.baseline, row.difference) ?? '—'}
                </Box>
              </>
            ),
        },
      ];
    }
    return [
      group,
      ...(result?.periods ?? []).map((period, index): TableProps.ColumnDefinition<BreakdownRow> => ({
        id: `period-${period.start}`,
        header: (
          <>
            {formatPeriodLabel(period.start, request.granularity)}
            {period.estimated ? (
              <Box variant="small" color="text-status-warning" display="inline-block" margin={{ left: 'xxs' }}>
                est.
              </Box>
            ) : null}
          </>
        ),
        cell: (row) => row.kind === 'standard' && formatCostValue(row.values[index] ?? '0', unit),
      })),
      {
        id: 'total',
        header: 'Total',
        ariaLabel: sortLabel('Total'),
        sortingComparator: byTotal,
        cell: (row) => row.kind === 'standard' && <Box fontWeight="bold">{formatCostValue(row.total, unit)}</Box>,
      },
    ];
  }, [comparison, request.granularity, result?.periods, unit]);

  const { items, collectionProps, paginationProps, actions } = useCollection(rows, {
    sorting: { defaultState: { sortingColumn: columns[0], isDescending: false } },
    pagination: { pageSize: PAGE_SIZE },
  });

  const exportReport = async () => {
    if (!onExportCsv) return;
    setExporting(true);
    setExportError(null);
    try {
      await onExportCsv();
    } catch (cause) {
      setExportError(
        cause instanceof Error ? cause.message : 'Could not export this report.',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <SpaceBetween size="l">
      <Table
        {...collectionProps}
        // Group starts ascending, totals start largest-first, as before.
        onSortingChange={({ detail }) => {
          const sameColumn = detail.sortingColumn.sortingComparator === collectionProps.sortingColumn?.sortingComparator;
          actions.setSorting({
            sortingColumn: detail.sortingColumn,
            isDescending: sameColumn ? detail.isDescending : detail.sortingColumn.sortingComparator === byTotal,
          });
        }}
        data-testid="desktop-cost-breakdown"
        variant="container"
        columnDefinitions={columns}
        items={items}
        trackBy="id"
        header={
          <Header
            variant="h2"
            description="Complete grouped results. Values retain AWS precision in CSV exports."
            actions={
              onExportCsv ? (
                <Button iconName="download" loading={exporting} onClick={() => void exportReport()}>
                  {exporting ? 'Preparing CSV…' : 'Export CSV'}
                </Button>
              ) : undefined
            }
          >
            Cost and usage breakdown
          </Header>
        }
        empty={<Box textAlign="center" color="inherit">No breakdown rows for this report.</Box>}
        pagination={rows.length ? <Pagination {...paginationProps} ariaLabels={PAGINATION_LABELS} /> : undefined}
        footer={
          exportError ? (
            <div role="alert">
              <StatusIndicator type="error">{exportError}</StatusIndicator>
            </div>
          ) : undefined
        }
      />
        {comparison?.drivers.length ? (
          <section aria-labelledby="cost-drivers-heading">
            <Header variant="h3">
              <span id="cost-drivers-heading">Cost drivers</span>
            </Header>
            <div role="list">
            <ColumnLayout columns={3} variant="text-grid">
              {comparison.drivers.map((driver, index) => {
                const metric = comparisonMetricName
                  ? driver.metrics[comparisonMetricName]
                  : undefined;
                return (
                  <div key={`driver-${index}`} role="listitem">
                    <Box variant="awsui-key-label">
                      {driver.name
                        ? displayGroupedLabel(driver.name, request.groupBy)
                        : displayGroupValues(driver.groupValues, request.groupBy)}
                    </Box>
                    {metric ? (
                      <Box color="text-body-secondary">
                        {formatCostValue(metric.difference, metric.unit, {
                          signDisplay: 'exceptZero',
                        })}
                      </Box>
                    ) : null}
                  </div>
                );
              })}
            </ColumnLayout>
            </div>
          </section>
        ) : null}
    </SpaceBetween>
  );
}
