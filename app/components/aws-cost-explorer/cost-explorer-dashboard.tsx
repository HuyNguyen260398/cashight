'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import {
  AlertTriangle,
  Cloud,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  X,
} from 'lucide-react';

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
  serializeCostReportSearch,
} from '@/frontend/lib/aws-cost-explorer-url';
import { cn } from '@/lib/utils';

const PARAMETERS_PANEL_ID = 'cost-report-parameters';

/**
 * The width at which the parameters panel is a real sidebar column. Below it
 * the panel would otherwise land beneath the charts, far past the fold, so it
 * becomes a right-hand slide-over instead — the same drawer pattern the
 * navigation uses in admin-shell.tsx, mirrored to the other edge.
 */
const SIDEBAR_QUERY = '(min-width: 1280px)';

/**
 * True where the panel is a sidebar column rather than a drawer.
 *
 * Guarded rather than called directly: matchMedia is absent in jsdom and in
 * older browsers, and an unguarded call there takes the whole dashboard down
 * with a TypeError. Falling back to the sidebar is the safe answer — it
 * renders inline, needs no scrim, and matches the pre-drawer behaviour.
 */
function isSidebarLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia(SIDEBAR_QUERY).matches;
}

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
  const cooldownActive = useRefreshCooldown(state.refreshCooldownUntil);
  /**
   * Open by default only where it is a sidebar. As a drawer it overlays the
   * report, so opening it unasked would bury the numbers the page exists for.
   *
   * Reading layout in an initialiser is safe here: this component mounts only
   * after the capabilities gate resolves, which is always client-side, so it
   * never renders during prerender or hydration.
   */
  const [parametersVisible, setParametersVisible] = useState(isSidebarLayout);

  // Escape closes the drawer, matching the navigation drawer's behaviour. It
  // must not collapse the sidebar at xl, where nothing is overlaid.
  useEffect(() => {
    if (!parametersVisible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isSidebarLayout()) return;
      setParametersVisible(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [parametersVisible]);

  /**
   * Everything in the request except `chartStyle` decides what AWS is asked for.
   * `chartStyle` is presentational, but it still travels in the URL — and Next's
   * router observes `replaceState` — so keying the run on the full request would
   * spend a fresh AWS round trip every time the chart toggle is clicked.
   */
  const queryKey = useMemo(
    () => JSON.stringify({ ...initialRequest, chartStyle: undefined }),
    [initialRequest],
  );
  const lastQueryKey = useRef<string | null>(null);

  // Clear on unmount only: the hook aborts its in-flight query when it unmounts,
  // so a remount (StrictMode does one in dev) has to be free to query again.
  useEffect(() => () => {
    lastQueryKey.current = null;
  }, []);

  useEffect(() => {
    if (lastQueryKey.current === queryKey) return;
    lastQueryKey.current = queryKey;
    run(initialRequest);
  }, [initialRequest, queryKey, run]);

  const activeRequest = state.request ?? initialRequest;
  const [chartStyle, setChartStyle] = useState<
    CostExplorerReportRequest['chartStyle']
  >(activeRequest.chartStyle);
  const [styleSource, setStyleSource] = useState(activeRequest);

  // Adjust during render rather than in an effect: a newly applied report brings
  // its own style, which must replace whatever the toggle was last set to.
  if (styleSource !== activeRequest) {
    setStyleSource(activeRequest);
    setChartStyle(activeRequest.chartStyle);
  }

  /**
   * Chart style is presentational, but it is part of the canonical query digest,
   * so re-running the report to change it would cost a fresh AWS round trip.
   * Keep it client-side and only rewrite the URL, which `useSearchParams` does
   * not observe — so no re-query is triggered.
   */
  const changeChartStyle = (next: CostExplorerReportRequest['chartStyle']) => {
    setChartStyle(next);
    const url = new URL(window.location.href);
    url.search = serializeCostReportSearch({
      ...activeRequest,
      chartStyle: next,
    }).toString();
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
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
            variant="outline"
            className="min-h-11 self-start"
            aria-expanded={parametersVisible}
            aria-controls={PARAMETERS_PANEL_ID}
            onClick={() => setParametersVisible((visible) => !visible)}
          >
            {parametersVisible ? (
              <PanelRightClose aria-hidden />
            ) : (
              <PanelRightOpen aria-hidden />
            )}
            {parametersVisible ? 'Hide report parameters' : 'Show report parameters'}
          </Button>
        </div>
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
        {/* One report column, so the sidebar starts level with the overview and
            the breakdown stays directly under its own chart. */}
        <div
          className={cn(
            'col-span-12 space-y-4 md:space-y-6',
            parametersVisible && 'xl:col-span-8',
          )}
        >
          {state.status === 'loading' || state.status === 'idle' ? (
            <>
              <div aria-live="polite">
                <p className="sr-only">Loading cost and usage…</p>
                <PanelSkeleton label="Loading cost and usage overview" />
              </div>
              <PanelSkeleton label="Loading cost and usage graph" />
              <PanelSkeleton label="Loading cost and usage breakdown" />
            </>
          ) : state.status === 'success' ? (
            <>
              <CostOverview
                request={activeRequest}
                result={state.result}
                forecast={state.forecast}
                comparison={state.comparison}
              />
              <CostUsageGraph
                request={activeRequest}
                result={state.result}
                forecast={state.forecast}
                comparison={state.comparison}
                chartStyle={chartStyle}
                onChartStyleChange={changeChartStyle}
              />
              <CostBreakdown
                request={activeRequest}
                result={state.result}
                comparison={state.comparison}
                onExportCsv={() => exportCsv(activeRequest)}
              />
            </>
          ) : null}
        </div>

        {/* Tap-outside scrim for the drawer. Absent at xl, where the panel is
            a column beside the report rather than over it. */}
        {parametersVisible ? (
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default bg-gray-900/50 xl:hidden"
            onClick={() => setParametersVisible(false)}
          />
        ) : null}

        {/* One element, two layouts: a right-hand slide-over below xl, the
            sidebar column at xl and up.

            Never unmounted, and never display:none below xl — collapsing must
            not discard an unapplied draft, and the panel has to stay in the box
            tree for the slide to animate. `inert` is what keeps the off-screen
            copy out of the tab order while it is closed. */}
        <aside
          id={PARAMETERS_PANEL_ID}
          // Not the `hidden` attribute: below xl the drawer has to stay in the
          // box tree for the slide to animate, and `hidden` wins over any
          // utility that would re-show it. `xl:hidden` drops the column where
          // there is nothing to animate, and `inert` is what keeps the
          // off-screen copy out of the tab order and the a11y tree.
          inert={!parametersVisible}
          className={cn(
            'fixed inset-y-0 right-0 z-50 w-[min(26rem,100vw-2.5rem)] overflow-y-auto bg-gray-50 p-4 shadow-theme-lg transition-transform duration-300 dark:bg-gray-950',
            'xl:static xl:z-auto xl:col-span-4 xl:w-auto xl:overflow-visible xl:bg-transparent xl:p-0 xl:shadow-none xl:transition-none dark:xl:bg-transparent',
            parametersVisible ? 'translate-x-0' : 'translate-x-full xl:hidden',
          )}
        >
          <div className="mb-3 flex justify-end xl:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close parameters drawer"
              onClick={() => setParametersVisible(false)}
            >
              <X aria-hidden />
            </Button>
          </div>
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
            chartStyle={chartStyle}
            onChartStyleChange={changeChartStyle}
          />
        </aside>
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
