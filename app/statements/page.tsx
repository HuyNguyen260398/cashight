'use client';

import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  StatementsTable,
} from '@/app/components/statements-table';
import { FileText, Loader2, UploadCloud } from 'lucide-react';
import { useStatements } from '@/frontend/hooks/use-statements';
import { ProtectedRoute } from '@/frontend/auth/protected-route';

export default function StatementsPage() {
  const { items, loading, loadingMore, error, deleteStatement, nextCursor, loadMore } = useStatements();

  async function handleDelete(key: string) {
    try {
      await deleteStatement(key);
      toast.success('Statement deleted');
    } catch {
      toast.error('Could not delete statement');
    }
  }

  return (
    <ProtectedRoute>
    <main className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
            Statement library
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
            Statements
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Browse saved monthly statements and jump back into period views.
          </p>
        </div>
        <Button asChild className="sm:self-start">
          <Link href="/upload">
            <UploadCloud className="size-4" aria-hidden />
            Upload another
          </Link>
        </Button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-brand-500" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-error-500/20 bg-error-50 p-5 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-500">
          <p className="font-medium">Could not load statements.</p>
          <p className="mt-1 text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
            <FileText className="size-7" aria-hidden />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white/90">
            No statements yet
          </h2>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            Upload a statement to get started.
          </p>
          <Button asChild>
            <Link href="/upload">Upload statement</Link>
          </Button>
        </div>
      ) : (
        <>
          <StatementsTable rows={items} onDelete={handleDelete} />
          {nextCursor !== null && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loading || loadingMore}
              >
                {loadingMore && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </main>
    </ProtectedRoute>
  );
}
