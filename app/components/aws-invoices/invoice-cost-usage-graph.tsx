'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Container from '@cloudscape-design/components/container';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { YearMonth } from '@cashight/domain/aws-invoices';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';

import { CognitoReauthWarning } from '@/app/components/aws-cost-explorer/cognito-reauth-warning';
import { CostUsageGraph } from '@/app/components/aws-cost-explorer/cost-usage-graph';
import { useCostExplorer } from '@/frontend/hooks/use-cost-explorer';
import { useSessionCapabilities } from '@/frontend/hooks/use-session-capabilities';
import { AlertHeading } from '@/app/components/console/alert-heading';

type ChartStyle = CostExplorerReportRequest['chartStyle'];

/**
 * The Cost Explorer report behind the invoice month on screen: daily spend
 * grouped by service.
 *
 * The end date is the first of the *following* month — Cost Explorer treats it
 * as exclusive, and `TimePeriodSchema` requires `start < end`, so December has
 * to roll the year.
 */
export function invoiceCostReportRequest(
  yearMonth: YearMonth,
  chartStyle: ChartStyle,
): CostExplorerReportRequest {
  const [year, month] = yearMonth.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 1));
  return {
    mode: 'STANDARD',
    timePeriod: {
      start: `${yearMonth}-01`,
      end: end.toISOString().slice(0, 10),
    },
    granularity: 'DAILY',
    metric: 'UnblendedCost',
    groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
    chartStyle,
    showForecast: false,
    showOnlyUntagged: false,
    showOnlyUncategorized: false,
  };
}

function GraphSkeleton() {
  return (
    <Container>
      <div aria-label="Loading cost and usage graph" aria-busy="true">
        <StatusIndicator type="loading">Loading cost and usage graph…</StatusIndicator>
      </div>
    </Container>
  );
}

/**
 * The Cost Explorer graph panel, scoped to the invoice month beside it.
 *
 * The figures come from Cost Explorer, not from the invoice PDF, so they will
 * not tie out to the invoice's charges plus tax — credits and tax treatment
 * differ. The invoice's own reconciled numbers stay authoritative in the KPI
 * cards, the charge composition panel, and the services table.
 */
export function InvoiceCostUsageGraph({ yearMonth }: { yearMonth: YearMonth }) {
  const capabilities = useSessionCapabilities();
  const canViewAwsCosts = capabilities.data?.canViewAwsCosts ?? false;
  const { state, run } = useCostExplorer({ loadReports: false });
  const [chartStyle, setChartStyle] = useState<ChartStyle>('STACK');

  // Chart style stays out of the URL: this page's query string is `?year=&month=`,
  // and a presentational toggle has no business in the month the page reads back.
  const request = useMemo(
    () => invoiceCostReportRequest(yearMonth, chartStyle),
    [chartStyle, yearMonth],
  );

  /**
   * Only the month decides what AWS is asked for, so keying the run on the
   * whole request would spend a fresh round trip on every toggle click.
   */
  const lastQueryKey = useRef<string | null>(null);
  useEffect(() => () => {
    // Clear on unmount only — the hook aborts its in-flight query when it
    // unmounts, so a remount (StrictMode does one in dev) must query again.
    lastQueryKey.current = null;
  }, []);

  useEffect(() => {
    if (!canViewAwsCosts || lastQueryKey.current === yearMonth) return;
    lastQueryKey.current = yearMonth;
    run(request);
  }, [canViewAwsCosts, request, run, yearMonth]);

  if (capabilities.loading) return <GraphSkeleton />;
  if (!canViewAwsCosts) return <CognitoReauthWarning />;
  if (state.status === 'error') {
    if (state.error?.code === 'COGNITO_REAUTH_REQUIRED') {
      return <CognitoReauthWarning />;
    }
    return (
      <div role="alert">
        <Alert type="error" header={<AlertHeading>Couldn&apos;t load the cost and usage graph</AlertHeading>}>
          {state.error?.message ?? 'The AWS cost query failed. Try again shortly.'}
        </Alert>
      </div>
    );
  }
  if (state.status !== 'success') return <GraphSkeleton />;

  return (
    <CostUsageGraph
      request={state.request ?? request}
      result={state.result}
      forecast={state.forecast}
      comparison={state.comparison}
      chartStyle={chartStyle}
      onChartStyleChange={setChartStyle}
    />
  );
}
