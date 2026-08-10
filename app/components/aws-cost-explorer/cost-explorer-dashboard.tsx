'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Cloud, Download, Loader2, RefreshCw } from 'lucide-react';

import { ReportParameters } from './report-parameters';
import { CostBreakdown } from './cost-breakdown';
import { CostOverview } from './cost-overview';
import { CostUsageGraph } from './cost-usage-graph';
import { CognitoReauthWarning } from './cognito-reauth-warning';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCostExplorer } from '@/frontend/hooks/use-cost-explorer';
import { useSessionCapabilities } from '@/frontend/hooks/use-session-capabilities';
import {
  createDefaultCostReportRequest,
  parseCostReportSearch,
} from '@/frontend/lib/aws-cost-explorer-url';

function PanelSkeleton({ label }: { label: string }) {
  return (
    <Card aria-label={label} aria-busy="true">
      <CardContent className="space-y-4 pt-1">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-52 w-full" />
      </CardContent>
    </Card>
  );
}

function AccessState({
  label,
  error,
  onRetry,
}: {
  label: string;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <main className="space-y-6" aria-busy={!error}>
      <header className="surface-card p-5 md:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            {error ? (
              <AlertTriangle className="size-5" aria-hidden />
            ) : (
              <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
            )}
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white/90">
              AWS Cost Explorer
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{label}</p>
          </div>
        </div>
        {error && onRetry ? (
          <Button type="button" variant="outline" className="mt-4 min-h-11" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </header>
    </main>
  );
}

function useRefreshCooldown(until: string | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  const timestamp = until ? Date.parse(until) : Number.NaN;
  const active = Number.isFinite(timestamp) && timestamp > now;

  useEffect(() => {
    if (!active) return;
    const delay = Math.min(timestamp - Date.now() + 25, 2_147_483_647);
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(25, delay));
    return () => window.clearTimeout(timer);
  }, [active, timestamp]);

  return active;
}

function NativeCostExplorerDashboard() {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const initialRequest = useMemo(
    () =>
      parseCostReportSearch(
        search,
        createDefaultCostReportRequest(),
      ),
    [search],
  );
  const {
    state,
    reports,
    reportsLoading,
    reportsError,
    run,
    refresh,
    saveReport,
    deleteReport,
    exportCsv,
  } = useCostExplorer();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const cooldownActive = useRefreshCooldown(state.refreshCooldownUntil);

  useEffect(() => {
    run(initialRequest);
  }, [initialRequest, run]);

  const activeRequest = state.request ?? initialRequest;
  const exportReport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await exportCsv(activeRequest);
    } catch (cause) {
      setExportError(
        cause instanceof Error ? cause.message : 'Could not export this report.',
      );
    } finally {
      setExporting(false);
    }
  };

  if (
    state.status === 'error' &&
    state.error?.code === 'COGNITO_REAUTH_REQUIRED'
  ) {
    return (
      <main className="space-y-6">
        <header className="surface-card p-5 md:p-6">
          <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
            AWS billing analytics
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
            AWS Cost Explorer
          </h1>
        </header>
        <CognitoReauthWarning />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="surface-card flex flex-col gap-4 p-5 md:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <Cloud className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
              AWS billing analytics
            </p>
            <h1 className="mt-0.5 text-2xl font-semibold text-gray-900 dark:text-white/90">
              AWS Cost Explorer
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Explore deployment-account costs with cached, read-only AWS queries.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={cooldownActive || state.status === 'loading'}
              onClick={refresh}
              aria-label="Refresh from AWS"
            >
              <RefreshCw className={state.status === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />
              Refresh from AWS
            </Button>
            {cooldownActive ? (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Manual refresh available after{' '}
                {new Intl.DateTimeFormat('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'UTC',
                }).format(new Date(state.refreshCooldownUntil!))}{' '}
                UTC
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            className="min-h-11"
            disabled={exporting || state.status !== 'success'}
            onClick={() => void exportReport()}
          >
            {exporting ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            {exporting ? 'Preparing CSV…' : 'Export CSV'}
          </Button>
        </div>
        {exportError ? (
          <p role="alert" className="text-sm text-error-700 dark:text-error-400">
            {exportError}
          </p>
        ) : null}
      </header>

      {state.status === 'error' ? (
        <div className="rounded-2xl border border-error-200 bg-error-50 p-5 dark:border-error-500/30 dark:bg-error-500/10">
          <h2 className="font-semibold text-gray-900 dark:text-white/90">
            Couldn&apos;t load Cost Explorer
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {state.error?.message ?? 'The AWS cost query failed. Adjust the report or try again.'}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-12 gap-4 md:gap-6">
        {state.status === 'loading' || state.status === 'idle' ? (
          <>
            <div className="col-span-12" aria-live="polite">
              <p className="sr-only">Loading cost and usage…</p>
              <PanelSkeleton label="Loading cost and usage overview" />
            </div>
            <div className="col-span-12 xl:col-span-8">
              <PanelSkeleton label="Loading cost and usage graph" />
            </div>
          </>
        ) : state.status === 'success' ? (
          <>
            <div className="col-span-12">
              <CostOverview
                result={state.result}
                forecast={state.forecast}
                comparison={state.comparison}
              />
            </div>
            <div className="col-span-12 xl:col-span-8">
              <CostUsageGraph
                request={activeRequest}
                result={state.result}
                forecast={state.forecast}
                comparison={state.comparison}
              />
            </div>
          </>
        ) : null}

        <aside className="col-span-12 xl:col-span-4">
          <ReportParameters
            initialRequest={initialRequest}
            granularDataEnabled={false}
            compact
            onApply={run}
            savedReports={reports}
            reportsLoading={reportsLoading}
            reportsError={reportsError}
            onSaveReport={saveReport}
            onDeleteReport={deleteReport}
          />
        </aside>

        {state.status === 'success' ? (
          <div className="col-span-12">
            <CostBreakdown
              request={activeRequest}
              result={state.result}
              comparison={state.comparison}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function CostExplorerDashboard() {
  const capabilities = useSessionCapabilities();

  if (capabilities.loading) {
    return <AccessState label="Checking AWS cost access…" />;
  }
  if (capabilities.error) {
    return (
      <AccessState
        label="AWS cost access could not be checked."
        error={capabilities.error}
        onRetry={capabilities.reload}
      />
    );
  }
  if (!capabilities.data?.canViewAwsCosts) {
    return (
      <main className="space-y-6">
        <header className="surface-card p-5 md:p-6">
          <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
            AWS billing analytics
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
            AWS Cost Explorer
          </h1>
        </header>
        <CognitoReauthWarning />
      </main>
    );
  }

  return <NativeCostExplorerDashboard />;
}
