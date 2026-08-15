'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { YearMonth } from '@cashight/domain/aws-invoices';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';

import { CognitoReauthWarning } from '@/app/components/aws-cost-explorer/cognito-reauth-warning';
import { CostUsageGraph } from '@/app/components/aws-cost-explorer/cost-usage-graph';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCostExplorer } from '@/frontend/hooks/use-cost-explorer';
import { useSessionCapabilities } from '@/frontend/hooks/use-session-capabilities';

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
    <Card aria-label="Loading cost and usage graph" aria-busy="true">
      <CardContent className="space-y-4 pt-1">
        <Skeleton className="h-5 w-48 motion-reduce:animate-none" />
        <Skeleton className="h-64 w-full motion-reduce:animate-none" />
      </CardContent>
    </Card>
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
      <div
        role="alert"
        className="rounded-2xl border border-error-200 bg-error-50 p-5 dark:border-error-500/30 dark:bg-error-500/10"
      >
        <h2 className="font-semibold text-gray-900 dark:text-white/90">
          Couldn&apos;t load the cost and usage graph
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {state.error?.message ?? 'The AWS cost query failed. Try again shortly.'}
        </p>
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
