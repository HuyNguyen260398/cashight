import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { UploadCloud } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
        <UploadCloud className="size-7" aria-hidden />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white/90">
        No statements yet
      </h2>
      <p className="mx-auto mb-6 max-w-md text-sm text-gray-500 dark:text-gray-400">
        Upload a statement to get started.
      </p>
      <Button asChild>
        <Link href="/upload">Upload statement</Link>
      </Button>
    </div>
  );
}
