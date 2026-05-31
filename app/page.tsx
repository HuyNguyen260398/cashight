import { redirect } from 'next/navigation';
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
    <main className="container mx-auto p-4 md:p-6 max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-medium">Cashight</h1>
        <PeriodSelector current={spec} />
      </header>
      {error ? (
        <div className="py-16 text-center">
          <h2 className="mb-2 text-xl">Couldn&apos;t load your statements</h2>
          <p className="text-muted-foreground">{error}</p>
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
