import { getAllStatements } from '@/lib/storage';
import { aggregate } from '@/lib/aggregations';
import { parsePeriodFromSearch } from '@/lib/period';
import { Dashboard } from '@/app/components/dashboard';
import { PeriodSelector } from '@/app/components/period-selector';
import { EmptyState } from '@/app/components/empty-state';
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
    error = err instanceof Error ? err.message : 'Failed to load statements';
  }

  const view = aggregate(statements, spec);

  return (
    <main className="container mx-auto p-4 md:p-6 max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-medium">Expense tracker</h1>
        <PeriodSelector current={spec} />
      </header>
      {error ? (
        <p className="text-red-600">Error: {error}</p>
      ) : statements.length === 0 ? (
        <EmptyState />
      ) : (
        <Dashboard view={view} />
      )}
    </main>
  );
}
