'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { notify } from '@/app/components/console/notifications';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { DEFAULT_BANK, bankShortName, parseBankFromSearch } from '@/lib/banks';
import { parsePeriodFromSearch } from '@/lib/period';
import type { UploadJob } from '@/frontend/api/contracts';
import { useBankStatements } from '@/frontend/hooks/use-bank-statements';
import { useDashboard } from '@/frontend/hooks/use-dashboard';
import { initialPeriodHref } from '@/frontend/lib/initial-period';
import { statementDashboardHref } from '@/frontend/lib/dashboard-routes';
import { statementRows } from '@/frontend/lib/statement-history';
import { BankSelector } from './bank-selector';
import { PeriodSelector } from './period-selector';
import { Dashboard } from './dashboard';
import { EmptyState } from './empty-state';
import { EmptyPeriodState } from './empty-period-state';
import { UploadDropzone } from './upload-dropzone';
import { BankStatementHistory } from './bank-statement-history';
import { AlertHeading } from '@/app/components/console/alert-heading';

function DashboardSkeleton() {
  return (
    <Container>
      <div aria-label="Loading spending analytics" aria-busy="true">
        <StatusIndicator type="loading">Loading spending analytics…</StatusIndicator>
      </div>
    </Container>
  );
}

export function BankStatementDashboard() {
  const search = useSearchParams();
  // A different bank gets fresh mutation state and cancels the old data lifecycle.
  return <BankDashboardContent key={search.get('bank') ?? ''} />;
}

function BankDashboardContent() {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const router = useRouter();
  const requestedBank = parseBankFromSearch(searchParams);
  const hasPeriod = searchParams.has('period');
  const spec = parsePeriodFromSearch(searchParams);
  const history = useBankStatements();
  const { refresh: refreshHistory, deleteStatement } = history;
  const { data: view, loading: dashboardLoading, error, refresh: refreshDashboard } = useDashboard(hasPeriod ? spec : null, requestedBank);
  const emptyCollection = !history.loading && !history.error && history.items.length === 0;
  const effectiveBank = requestedBank ?? view?.selectedBank ?? (emptyCollection ? DEFAULT_BANK : null);
  const [pendingUpload, setPendingUpload] = useState<{ job: UploadJob; search: string } | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const activeSearch = useRef<string | null>(search);
  const uploadNavigation = useRef(false);

  // A retry belongs to the view where the upload finished. Reset it before
  // rendering a different period so it cannot block later initial navigation.
  if (pendingUpload && pendingUpload.search !== search) {
    setPendingUpload(null);
    setUploadNotice(null);
  }

  useEffect(() => {
    activeSearch.current = search;
    uploadNavigation.current = false;
    return () => { activeSearch.current = null; };
  }, [search]);

  useEffect(() => {
    if (uploadNavigation.current || hasPeriod || history.loading || history.refreshing || history.error || pendingUpload) return;
    const href = initialPeriodHref(history.items, search, requestedBank);
    if (href) router.replace(`${href}${window.location.hash}`);
  }, [hasPeriod, history.loading, history.refreshing, history.error, history.items, pendingUpload, search, requestedBank, router]);

  const handleUploadSucceeded = useCallback((job: UploadJob) => {
    if (activeSearch.current !== search) return;
    setPendingUpload({ job, search });
    setUploadNotice(null);
    refreshDashboard();
    void (async () => {
      try {
        const items = await refreshHistory();
        if (activeSearch.current !== search) return;
        const item = items.find((candidate) => candidate.statementId === job.statementId);
        if (!item) {
          setUploadNotice('Statement saved, but its dashboard could not be located yet. Retry refreshing the saved statement.');
          return;
        }
        const row = statementRows([item], item.bank)[0];
        uploadNavigation.current = true;
        setPendingUpload(null);
        router.push(statementDashboardHref(row));
      } catch {
        if (activeSearch.current === search) {
          setUploadNotice('Statement saved, but the view could not be refreshed. Retry refreshing the saved statement.');
        }
      }
    })();
  }, [search, refreshDashboard, refreshHistory, router]);

  async function handleDelete(id: string) {
    await deleteStatement(id);
    if (activeSearch.current !== search) return;
    notify({ type: 'success', content: 'Statement deleted' });
    refreshDashboard();
  }

  function retryHistory() {
    void refreshHistory().catch(() => undefined);
  }

  return (
    <div>
      <ContentLayout
        header={
          <Header
            variant="h1"
            description="Upload monthly statements and review your spending, installments, and merchants."
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                <BankSelector current={effectiveBank ?? DEFAULT_BANK} available={view?.availableBanks ?? []} />
                <PeriodSelector current={spec} />
              </SpaceBetween>
            }
          >
            {effectiveBank ? `${bankShortName(effectiveBank)} bank statements` : 'Bank statements'}
          </Header>
        }
      >
        <SpaceBetween size="l">
          <section id="statement-upload" aria-label="Upload statement" className="console-anchor">
            <UploadDropzone bank={effectiveBank ?? undefined} onSucceeded={handleUploadSucceeded} />
          </section>
          {uploadNotice ? (
            <div role="status">
              <Alert
                type="info"
                action={
                  <Button onClick={() => { if (pendingUpload) handleUploadSucceeded(pendingUpload.job); }}>
                    Refresh saved statement
                  </Button>
                }
              >
                {uploadNotice}
              </Alert>
            </div>
          ) : null}

          {!hasPeriod ? (
            emptyCollection ? <EmptyState /> : history.error ? null : <DashboardSkeleton />
          ) : dashboardLoading ? (
            <DashboardSkeleton />
          ) : error ? (
            <div role="alert">
              <Alert
                type="error"
                header={<AlertHeading>Couldn&apos;t load spending analytics</AlertHeading>}
                action={<Button onClick={refreshDashboard}>Retry analytics</Button>}
              >
                {error}
              </Alert>
            </div>
          ) : view?.statementCount === 0 ? (
            <EmptyPeriodState spec={spec} bank={effectiveBank ?? DEFAULT_BANK} />
          ) : view ? <Dashboard view={view} /> : <DashboardSkeleton />}

          {history.refreshing && !history.loading ? <p role="status" className="visually-hidden">Refreshing statement history…</p> : null}
          <BankStatementHistory items={history.items} bank={effectiveBank} loading={history.loading} error={history.error} onRetry={retryHistory} onDelete={handleDelete} />
        </SpaceBetween>
      </ContentLayout>
    </div>
  );
}
