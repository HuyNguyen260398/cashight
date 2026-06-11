import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/require-session';
import { getAllStatements, isAuthError, STORAGE_AUTH_HINT } from '@/lib/storage';
import { aggregate } from '@/lib/aggregations';
import { parsePeriodFromSearch } from '@/lib/period';
import { Dashboard } from '@/app/components/dashboard';
import { PeriodSelector } from '@/app/components/period-selector';
import { EmptyState } from '@/app/components/empty-state';
import { EmptyPeriodState } from '@/app/components/empty-period-state';
import type { Statement } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();

  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(resolved)) {
    if (typeof v === 'string') params.append(k, v);
  }
  const spec = parsePeriodFromSearch(params);

  let statements: Statement[] = [];
  let error: string | null = null;
  try {
    statements = await getAllStatements();
  } catch (err) {
    error = isAuthError(err)
      ? STORAGE_AUTH_HINT
      : err instanceof Error
        ? err.message
        : 'Failed to load statements';
  }

  // Default to the most recent month with data when no period is requested.
  // `redirect` throws to short-circuit, so it MUST live outside the try/catch
  // above (otherwise the storage catch would swallow the control-flow error).
  if (!error && !params.has('period') && statements.length > 0) {
    const latest = [...statements].sort((a, b) =>
      b.statementDate.localeCompare(a.statementDate),
    )[0];
    const [year, month] = latest.statementDate.split('-').map(Number);
    redirect(`/?period=month&year=${year}&month=${month}`);
  }

  const view = error ? null : aggregate(statements, spec);

  return (
    <main className="space-y-6">
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
        <PeriodSelector current={spec} />
      </header>
      {error ? (
        <div className="rounded-2xl border border-error-500/20 bg-error-50 p-6 text-center dark:border-error-500/30 dark:bg-error-500/10">
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white/90">
            Couldn&apos;t load your statements
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      ) : statements.length === 0 ? (
        <EmptyState />
      ) : view!.statementCount === 0 ? (
        <EmptyPeriodState spec={spec} />
      ) : (
        <Dashboard view={view!} />
      )}
    </main>
  );
}
