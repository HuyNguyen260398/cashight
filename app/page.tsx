'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { parsePeriodFromSearch } from '@/lib/period';
import { DEFAULT_BANK, parseBankFromSearch } from '@/lib/banks';
import { Dashboard } from '@/app/components/dashboard';
import { PeriodSelector } from '@/app/components/period-selector';
import { BankSelector } from '@/app/components/bank-selector';
import { EmptyState } from '@/app/components/empty-state';
import { EmptyPeriodState } from '@/app/components/empty-period-state';
import { useDashboard } from '@/frontend/hooks/use-dashboard';
import { apiFetch } from '@/frontend/api/client';
import { getPublicConfig } from '@/frontend/auth/config';
import { StatementsListResponseSchema } from '@/frontend/api/contracts';
import { initialPeriodHref } from '@/frontend/lib/initial-period';
import { ProtectedRoute } from '@/frontend/auth/protected-route';

// ── Loading skeleton ─────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-40 rounded-2xl bg-gray-100 dark:bg-gray-800" />
      <div className="h-64 rounded-2xl bg-gray-100 dark:bg-gray-800" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-48 rounded-2xl bg-gray-100 dark:bg-gray-800" />
        <div className="h-48 rounded-2xl bg-gray-100 dark:bg-gray-800" />
      </div>
    </div>
  );
}

// ── Inner component (reads searchParams) ──────────────────────────────────────

function DashboardPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasPeriod = searchParams.has('period');
  // Value-stable dep for the redirect effect — `searchParams` is a new object
  // on every render.
  const search = searchParams.toString();

  const spec = parsePeriodFromSearch(searchParams);
  // null when the URL names no bank — the API then picks one that has data.
  const requestedBank = parseBankFromSearch(searchParams);

  // When no period is in the URL, fetch the statement list to find the most
  // recent month and redirect.  `fetchCompleted` is set to true only in async
  // callbacks so no synchronous setState call fires inside the effect body.
  const [fetchCompleted, setFetchCompleted] = useState(false);

  // Derived states — no setState needed.
  const redirectLoading = !hasPeriod && !fetchCompleted;
  const noStatements = !hasPeriod && fetchCompleted;

  useEffect(() => {
    // When a period is already in the URL (or the fetch has already run) there
    // is nothing to do — return immediately without calling setState.
    if (hasPeriod || fetchCompleted) return;

    let cancelled = false;
    const config = getPublicConfig();

    apiFetch(`${config.apiBaseUrl}/statements`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const parsed = StatementsListResponseSchema.parse(data);
        // Redirect to the most recent month that the requested bank has data
        // for, keeping the rest of the query string (notably `bank`) intact.
        const href = initialPeriodHref(parsed.items, search, requestedBank);
        if (href) {
          router.replace(href);
        } else {
          setFetchCompleted(true);
        }
      })
      .catch(() => {
        // On error, fall through to render with whatever the inferred spec is.
        if (!cancelled) setFetchCompleted(true);
      });

    return () => {
      cancelled = true;
    };
  }, [hasPeriod, fetchCompleted, router, search, requestedBank]);

  const { data: view, loading: dashLoading, error } = useDashboard(
    hasPeriod ? spec : null,
    requestedBank,
  );

  const header = (
    <header className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
          Spending overview
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
          Cashight dashboard
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Track statement totals, category mix, installments, and merchant spend.
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {/* `selectedBank` is the server's answer — when the URL names no bank
            it picked one that has data, and the dropdown must show that rather
            than a guess. Falls back to the URL's bank (then the default) while
            the view is still loading. */}
        <BankSelector
          current={view?.selectedBank ?? requestedBank ?? DEFAULT_BANK}
          available={view?.availableBanks ?? []}
        />
        <PeriodSelector current={spec} />
      </div>
    </header>
  );

  // No period yet: fetching statement list or no statements exist.
  if (!hasPeriod) {
    if (redirectLoading) {
      return (
        <main className="space-y-6">
          {header}
          <DashboardSkeleton />
        </main>
      );
    }
    if (noStatements) {
      return (
        <main className="space-y-6">
          {header}
          <EmptyState />
        </main>
      );
    }
    // Redirect is in progress — render nothing to avoid flicker.
    return null;
  }

  return (
    <main className="space-y-6">
      {header}
      {dashLoading || (!view && !error) ? (
        <DashboardSkeleton />
      ) : error ? (
        <div className="rounded-2xl border border-error-500/20 bg-error-50 p-6 text-center dark:border-error-500/30 dark:bg-error-500/10">
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white/90">
            Couldn&apos;t load your statements
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      ) : view!.statementCount === 0 ? (
        <EmptyPeriodState spec={spec} />
      ) : (
        <Dashboard view={view!} />
      )}
    </main>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────
// useSearchParams() requires a Suspense boundary somewhere in the tree.

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <Suspense>
        <DashboardPageInner />
      </Suspense>
    </ProtectedRoute>
  );
}
