'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { colorBackgroundLayoutMain, shadowContainerActive } from '@cloudscape-design/design-tokens';

import { ReportParameters } from './report-parameters';
import { CostBreakdown } from './cost-breakdown';
import { CostOverview } from './cost-overview';
import { CostUsageGraph } from './cost-usage-graph';
import { CognitoReauthWarning } from './cognito-reauth-warning';
import { useCostExplorer } from '@/frontend/hooks/use-cost-explorer';
import { useSessionCapabilities } from '@/frontend/hooks/use-session-capabilities';
import {
  createDefaultCostReportRequest,
  parseCostReportSearch,
  serializeCostReportSearch,
} from '@/frontend/lib/aws-cost-explorer-url';
import styles from './cost-explorer-layout.module.css';
import { AlertHeading } from '@/app/components/console/alert-heading';

const PARAMETERS_PANEL_ID = 'cost-report-parameters';

/**
 * The width at which the parameters panel is a real sidebar column. Below it
 * the panel would otherwise land beneath the charts, far past the fold, so it
 * becomes a right-hand slide-over instead — the same drawer pattern the
 * console uses for side panels, on the right-hand edge.
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

const PAGE_TITLE = 'AWS Cost Explorer';
const PAGE_DESCRIPTION = 'Explore deployment-account costs with cached, read-only AWS queries.';

function PanelSkeleton({ label }: { label: string }) {
  return (
    <Container>
      <div aria-label={label} aria-busy="true">
        <StatusIndicator type="loading">{label}…</StatusIndicator>
      </div>
    </Container>
  );
}

function PageShell({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <ContentLayout
        header={
          <Header variant="h1" description={PAGE_DESCRIPTION} actions={actions}>
            {PAGE_TITLE}
          </Header>
        }
      >
        <SpaceBetween size="l">{children}</SpaceBetween>
      </ContentLayout>
    </div>
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
    <div aria-busy={!error}>
      <ContentLayout header={<Header variant="h1">{PAGE_TITLE}</Header>}>
        {error ? (
          <Alert type="error" action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined}>
            {label}
          </Alert>
        ) : (
          <StatusIndicator type="loading">{label}</StatusIndicator>
        )}
      </ContentLayout>
    </div>
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
      <PageShell>
        <CognitoReauthWarning />
      </PageShell>
    );
  }

  const panelStyle = parametersVisible
    ? { background: colorBackgroundLayoutMain, boxShadow: shadowContainerActive }
    : { background: colorBackgroundLayoutMain };

  return (
    <PageShell
      actions={
        <SpaceBetween direction="horizontal" size="xs" alignItems="start">
          <SpaceBetween size="xxs">
            <Button
              iconName="refresh"
              loading={state.status === 'loading'}
              disabled={cooldownActive}
              onClick={refresh}
              ariaLabel="Refresh from AWS"
            >
              Refresh from AWS
            </Button>
            {cooldownActive ? (
              <Box variant="small" color="text-body-secondary">
                Manual refresh available after{' '}
                {new Intl.DateTimeFormat('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'UTC',
                }).format(new Date(state.refreshCooldownUntil!))}{' '}
                UTC
              </Box>
            ) : null}
          </SpaceBetween>
          <Button
            iconName={parametersVisible ? 'angle-right-double' : 'angle-left-double'}
            ariaExpanded={parametersVisible}
            ariaControls={PARAMETERS_PANEL_ID}
            onClick={() => setParametersVisible((visible) => !visible)}
          >
            {parametersVisible ? 'Hide report parameters' : 'Show report parameters'}
          </Button>
        </SpaceBetween>
      }
    >
      {state.status === 'error' ? (
        <Alert type="error" header={<AlertHeading>Couldn&apos;t load Cost Explorer</AlertHeading>}>
          {state.error?.message ?? 'The AWS cost query failed. Adjust the report or try again.'}
        </Alert>
      ) : null}

      <div className={parametersVisible ? styles.withSidebar : styles.layout}>
        {/* One report column, so the sidebar starts level with the overview and
            the breakdown stays directly under its own chart. */}
        <div className={styles.report}>
          <SpaceBetween size="l">
            {state.status === 'loading' || state.status === 'idle' ? (
              <>
                <div aria-live="polite">
                  <p className="visually-hidden">Loading cost and usage…</p>
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
          </SpaceBetween>
        </div>

        {/* Tap-outside scrim for the drawer; hidden at the sidebar width. */}
        {parametersVisible ? (
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className={styles.scrim}
            onClick={() => setParametersVisible(false)}
          />
        ) : null}

        {/* One element, two layouts: a right-hand slide-over below 1280px, a
            sidebar column above. Never unmounted — collapsing must not discard
            an unapplied draft — and `inert` keeps the closed copy out of the
            tab order and the accessibility tree. */}
        <aside
          id={PARAMETERS_PANEL_ID}
          inert={!parametersVisible}
          className={`${styles.panel} ${parametersVisible ? styles.panelOpen : styles.panelClosed}`}
          style={panelStyle}
        >
          <div className={styles.panelClose}>
            <Button
              variant="icon"
              iconName="close"
              ariaLabel="Close parameters drawer"
              onClick={() => setParametersVisible(false)}
            />
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
    </PageShell>
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
      <PageShell>
        <CognitoReauthWarning />
      </PageShell>
    );
  }

  return <NativeCostExplorerDashboard />;
}
