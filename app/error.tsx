'use client';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-error-500/20 bg-error-50 px-6 py-16 text-center dark:border-error-500/30 dark:bg-error-500/10">
      <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white/90">
        Something went wrong
      </h2>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
