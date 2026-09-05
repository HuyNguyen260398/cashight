'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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

function DashboardSkeleton() {
  return (
    <div aria-label="Loading spending analytics" aria-busy="true" className="space-y-4 animate-pulse motion-reduce:animate-none">
      <div className="h-40 rounded-2xl bg-gray-100 dark:bg-gray-800" />
      <div className="h-64 rounded-2xl bg-gray-100 dark:bg-gray-800" />
    </div>
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
  const [pendingUpload, setPendingUpload] = useState<UploadJob | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const activeSearch = useRef<string | null>(search);

  useEffect(() => {
    activeSearch.current = search;
    return () => { activeSearch.current = null; };
  }, [search]);

  useEffect(() => {
    if (hasPeriod || history.loading || history.refreshing || history.error || pendingUpload) return;
    const href = initialPeriodHref(history.items, search, requestedBank);
    if (href) router.replace(`${href}${window.location.hash}`);
  }, [hasPeriod, history.loading, history.refreshing, history.error, history.items, pendingUpload, search, requestedBank, router]);

  const handleUploadSucceeded = useCallback((job: UploadJob) => {
    if (activeSearch.current !== search) return;
    setPendingUpload(job);
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
    toast.success('Statement deleted');
    refreshDashboard();
  }

  function retryHistory() {
    void refreshHistory().catch(() => undefined);
  }

  return (
    <main className="space-y-6">
      <header className="surface-card flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-500 dark:text-brand-400">Spending overview</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
            {effectiveBank ? `${bankShortName(effectiveBank)} bank statements` : 'Bank statements'}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Upload monthly statements and review your spending, installments, and merchants.</p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <BankSelector current={effectiveBank ?? DEFAULT_BANK} available={view?.availableBanks ?? []} />
          <PeriodSelector current={spec} />
        </div>
      </header>

      <section id="statement-upload" aria-label="Upload statement" className="scroll-mt-24">
        <UploadDropzone bank={effectiveBank ?? undefined} onSucceeded={handleUploadSucceeded} />
      </section>
      {uploadNotice ? (
        <div role="status" className="surface-card space-y-3 p-5">
          <p className="text-sm text-gray-700 dark:text-gray-300">{uploadNotice}</p>
          <Button variant="outline" onClick={() => { if (pendingUpload) handleUploadSucceeded(pendingUpload); }}>Refresh saved statement</Button>
        </div>
      ) : null}

      {!hasPeriod ? (
        emptyCollection ? <EmptyState /> : history.error ? null : <DashboardSkeleton />
      ) : dashboardLoading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div role="alert" className="surface-card space-y-3 p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white/90">Couldn&apos;t load spending analytics</h2>
          <p className="text-sm text-error-700 dark:text-error-400">{error}</p>
          <Button variant="outline" onClick={refreshDashboard}>Retry analytics</Button>
        </div>
      ) : view?.statementCount === 0 ? (
        <EmptyPeriodState spec={spec} bank={effectiveBank ?? DEFAULT_BANK} />
      ) : view ? <Dashboard view={view} /> : <DashboardSkeleton />}

      {history.refreshing && !history.loading ? <p role="status" className="sr-only">Refreshing statement history…</p> : null}
      <BankStatementHistory items={history.items} bank={effectiveBank} loading={history.loading} error={history.error} onRetry={retryHistory} onDelete={handleDelete} />
    </main>
  );
}
