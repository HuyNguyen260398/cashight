import { Spinner } from '@/app/components/spinner';

// Root loading.tsx: the global Suspense fallback for every route that doesn't
// define a closer loading.tsx. Shown automatically during route navigation
// while the destination segment streams in.
export default function Loading() {
  return <Spinner />;
}
