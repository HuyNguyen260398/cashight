'use client';

import { useState } from 'react';
import { UploadDropzone } from '@/app/components/upload-dropzone';
import { Dashboard } from '@/app/components/dashboard';
import { aggregate } from '@/lib/aggregations';
import type { Statement } from '@/lib/schemas';
import { UploadCloud } from 'lucide-react';

export default function UploadPage() {
  const [statement, setStatement] = useState<Statement | null>(null);

  let view = null;
  if (statement) {
    const [year, month] = statement.statementDate.split('-').map(Number);
    view = aggregate([statement], { type: 'month', year, month });
  }

  return (
    <main className="space-y-6">
      <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
              Statement intake
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
              Upload statement
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
              Parse a TPBank PDF, mask card data, categorize transactions, and save the statement to S3.
            </p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
            <UploadCloud className="size-6" aria-hidden />
          </div>
        </div>
      </header>

      <div className={statement ? undefined : 'mx-auto max-w-4xl'}>
        <UploadDropzone onParsed={setStatement} />
      </div>
      {statement && view && (
        <div className="mt-6 space-y-6">
          <Dashboard view={view} />
        </div>
      )}
    </main>
  );
}
