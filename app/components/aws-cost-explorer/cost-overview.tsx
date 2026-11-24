'use client';

import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Icon from '@cloudscape-design/components/icon';
import SpaceBetween from '@cloudscape-design/components/space-between';
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
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <Box variant="awsui-value-large">{value}</Box>
      {detail ? (
        <Box variant="small" display="block" color="text-body-secondary">
          {detail}
        </Box>
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
    <Container
      header={
        <Header
          variant="h2"
          description={
            result ? (
              // Header descriptions render in a <p>, so keep this inline.
              <>
                <Badge color={result.source === 'CACHE' ? 'grey' : 'blue'}>
                  {result.source === 'CACHE' ? 'Cached AWS data' : 'Live AWS data'}
                </Badge>{' '}
                <Badge color={result.estimated ? 'severity-medium' : 'green'}>
                  {result.estimated ? 'Estimated' : 'Final'}
                </Badge>{' '}
                <Icon name="status-pending" size="small" /> Updated {formatFreshness(result.asOf)} UTC
              </>
            ) : comparison ? (
              'Comparison values returned by AWS Cost Explorer.'
            ) : undefined
          }
        >
          Cost and usage overview
        </Header>
      }
    >
        {result ? (
          <SpaceBetween size="l">
            <ColumnLayout columns={3} variant="text-grid">
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
            </ColumnLayout>
            {result.overview.currentMonthToDate !== undefined ||
            forecast ||
            result.overview.forecastTotal !== undefined ||
            result.overview.absoluteChange !== undefined ? (
              <ColumnLayout columns={3} variant="text-grid">
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
                      <span>
                        <Icon
                          name={decimalNumber(result.overview.absoluteChange) >= 0 ? 'arrow-up' : 'arrow-down'}
                          size="small"
                        />{' '}
                        {result.overview.percentageChange !== undefined
                          ? `${decimalNumber(result.overview.percentageChange).toFixed(1)}%`
                          : 'Compared with previous period'}
                      </span>
                    }
                  />
                ) : null}
              </ColumnLayout>
            ) : null}
          </SpaceBetween>
        ) : comparisonMetric ? (
          <ColumnLayout columns={3} variant="text-grid">
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
          </ColumnLayout>
        ) : (
          <Box textAlign="center" color="text-body-secondary" padding={{ vertical: 'l' }}>
            No cost data for this report.
          </Box>
        )}
    </Container>
  );
}
