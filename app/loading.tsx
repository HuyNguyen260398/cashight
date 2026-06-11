import { Spinner } from '@/app/components/spinner';

// Root loading.tsx: the global Suspense fallback for every route that doesn't
// define a closer loading.tsx. Shown automatically during route navigation
// while the destination segment streams in.
export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <Spinner />
    </div>
  );
}
