import { Spinner } from '@/app/components/spinner';

// Root loading.tsx: the global Suspense fallback for every route that doesn't
// define a closer loading.tsx. Shown automatically during route navigation
// while the destination segment streams in.
export default function Loading() {
  return (
    <main
      className="surface-card flex min-h-[50vh] items-center justify-center p-6"
      aria-busy="true"
      aria-label="Loading page"
    >
      <div className="flex flex-col items-center gap-3">
        <Spinner />
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    </main>
  );
}
