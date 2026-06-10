import { LoadingSpinner } from '@/app/components/loading-spinner';

// Route-level loading boundary for /upload. Using the shared spinner (instead of
// a skeleton) keeps the loading effect identical whether the route is reached
// from the nav, the "Upload another" button, or a direct load. Next renders this
// immediately on navigation, so the page-scoped <LinkLoadingOverlay> on those
// buttons would otherwise be unmounted before it could show.
export default function Loading() {
  return <LoadingSpinner />;
}
