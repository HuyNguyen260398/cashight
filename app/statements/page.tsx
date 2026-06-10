import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/require-session';
import { listStatements, getStatement } from '@/lib/storage';
import {
  StatementsTable,
  type StatementRow,
} from '@/app/components/statements-table';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StatementsPage() {
  await requireSession();

  let rows: StatementRow[] = [];
  let error: string | null = null;

  try {
    const items = await listStatements();
    const statements = await Promise.all(
      items.map((item) => getStatement(item.key)),
    );
    rows = items
      .map((item, i) => ({
        key: item.key,
        cardLast4: item.cardLast4,
        year: item.year,
        month: item.month,
        totalSpend: statements[i].totals.totalSpend,
        uploadedAt: item.lastModified?.toISOString() ?? null,
      }))
      .sort((a, b) => b.year - a.year || b.month - a.month);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load statements';
  }

  return (
    <main className="container mx-auto p-4 md:p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold">Statements</h1>
        <Button asChild>
          <Link href="/upload">Upload another</Link>
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-medium">Could not load statements.</p>
          <p className="text-muted-foreground">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="text-xl mb-2">No statements yet</h2>
          <p className="text-muted-foreground mb-6">
            Upload a statement to get started.
          </p>
          <Button asChild>
            <Link href="/upload">Upload statement</Link>
          </Button>
        </div>
      ) : (
        <StatementsTable rows={rows} />
      )}
    </main>
  );
}
