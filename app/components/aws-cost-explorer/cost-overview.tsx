'use client';

import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { ArrowDownRight, ArrowUpRight, Clock3, Database, Radio } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  CostExplorerComparison,
  CostExplorerCompleteResult,
  CostExplorerForecast,
} from '@/frontend/api/contracts';
import {
  decimalNumber,
  formatCostValue,
  formatFreshness,
  percentageFromDifference,
} from './cost-format';

export interface CostOverviewProps {
  request: CostExplorerReportRequest;
  result: CostExplorerCompleteResult | null;
  forecast: CostExplorerForecast | null;
  comparison: CostExplorerComparison | null;
}

const AVERAGE_LABELS: Record<CostExplorerReportRequest['granularity'], string> = {
  MONTHLY: 'Average monthly cost',
  DAILY: 'Average daily cost',
  HOURLY: 'Average hourly cost',
};

/**
 * Distinct services in the complete breakdown.
 *
 * `series` is capped at the top nine plus "Other" (REQ-3104), so the count has
 * to come from `breakdown`, which keeps every group. Only the SERVICE group
 * slot is counted — a report grouped by region or account carries no service
 * dimension, and inventing one from another dimension would be a wrong number
 * under a right-looking label.
 */
export function serviceCount(
  request: CostExplorerReportRequest,
  result: CostExplorerCompleteResult | null,
): number | null {
  const slot = request.groupBy.findIndex(
    (group) => group.type === 'DIMENSION' && group.key === 'SERVICE',
  );
  if (slot === -1 || !result) return null;
  const services = new Set<string>();
  for (const row of result.breakdown) {
    const value = row.groupValues[slot];
    if (value) services.add(value);
  }
  return services.size;
}

function OverviewMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-2 truncate text-xl font-semibold tabular-nums text-gray-900 dark:text-white/90">
        {value}
      </p>
      {detail ? (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export function CostOverview({
  request,
  result,
  forecast,
  comparison,
}: CostOverviewProps) {
  const comparisonMetric = comparison
    ? Object.values(comparison.total)[0]
    : undefined;
  const services = serviceCount(request, result);

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b border-gray-100 dark:border-gray-800">
        <CardTitle>
          <h2>Cost and usage overview</h2>
        </CardTitle>
        {result ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Badge variant="secondary" className="gap-1.5">
              {result.source === 'CACHE' ? (
                <Database className="size-3.5" aria-hidden />
              ) : (
                <Radio className="size-3.5" aria-hidden />
              )}
              {result.source === 'CACHE' ? 'Cached AWS data' : 'Live AWS data'}
            </Badge>
            <Badge variant={result.estimated ? 'outline' : 'secondary'}>
              {result.estimated ? 'Estimated' : 'Final'}
            </Badge>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3.5" aria-hidden />
              Updated {formatFreshness(result.asOf)} UTC
            </span>
          </div>
        ) : comparison ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Comparison values returned by AWS Cost Explorer.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <OverviewMetric
                label="Total cost"
                value={formatCostValue(result.overview.total, result.currencyOrUnit)}
                detail={result.estimated ? 'Includes estimated values' : 'Final values'}
              />
              <OverviewMetric
                label={AVERAGE_LABELS[request.granularity]}
                value={formatCostValue(result.overview.average, result.currencyOrUnit)}
                detail={`Across ${result.periods.length} ${
                  result.periods.length === 1 ? 'period' : 'periods'
                }`}
              />
              <OverviewMetric
                label="Service count"
                value={services === null ? '—' : services.toLocaleString('en-US')}
                detail={
                  services === null
                    ? 'Group by service to count services'
                    : 'Distinct services in range'
                }
              />
            </div>
            {result.overview.currentMonthToDate !== undefined ||
            forecast ||
            result.overview.forecastTotal !== undefined ||
            result.overview.absoluteChange !== undefined ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {result.overview.currentMonthToDate !== undefined ? (
                  <OverviewMetric
                    label="Month to date"
                    value={formatCostValue(
                      result.overview.currentMonthToDate,
                      result.currencyOrUnit,
                    )}
                    detail="Estimated current month"
                  />
                ) : null}
                {forecast ? (
                  <OverviewMetric
                    label="Forecast total"
                    value={formatCostValue(forecast.total, forecast.unit)}
                    detail="AWS forecast"
                  />
                ) : result.overview.forecastTotal !== undefined ? (
                  <OverviewMetric
                    label="Forecast total"
                    value={formatCostValue(
                      result.overview.forecastTotal,
                      result.currencyOrUnit,
                    )}
                  />
                ) : null}
                {result.overview.absoluteChange !== undefined ? (
                  <OverviewMetric
                    label="Previous period change"
                    value={formatCostValue(
                      result.overview.absoluteChange,
                      result.currencyOrUnit,
                      { signDisplay: 'exceptZero' },
                    )}
                    detail={
                      <span className="inline-flex items-center gap-1">
                        {decimalNumber(result.overview.absoluteChange) >= 0 ? (
                          <ArrowUpRight className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowDownRight className="size-3.5" aria-hidden />
                        )}
                        {result.overview.percentageChange !== undefined
                          ? `${decimalNumber(result.overview.percentageChange).toFixed(1)}%`
                          : 'Compared with previous period'}
                      </span>
                    }
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : comparisonMetric ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <OverviewMetric
              label="Baseline"
              value={formatCostValue(comparisonMetric.baseline, comparisonMetric.unit)}
            />
            <OverviewMetric
              label="Comparison"
              value={formatCostValue(comparisonMetric.comparison, comparisonMetric.unit)}
            />
            <OverviewMetric
              label="Change"
              value={formatCostValue(comparisonMetric.difference, comparisonMetric.unit, {
                signDisplay: 'exceptZero',
              })}
              detail={
                percentageFromDifference(
                  comparisonMetric.baseline,
                  comparisonMetric.difference,
                ) ?? 'No baseline percentage'
              }
            />
          </div>
        ) : (
          <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
            No cost data for this report.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
