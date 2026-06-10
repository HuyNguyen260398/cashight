import { requireSession } from '@/lib/require-session';

// `app/upload/page.tsx` is a Client Component and can't run the server-side
// `auth()` check itself, so this server-layout gates the whole /upload route.
// (The data-touching action, /api/parse, is independently guarded too.)
export const dynamic = 'force-dynamic';

// Minimum time the /upload segment stays unresolved, which keeps its loading.tsx
// Suspense fallback (the shared spinner) on screen for at least this long when
// navigating in — matching the in-nav LinkLoadingOverlay floor. A route-level
// loading.tsx can't enforce a client-side minimum (Next unmounts the fallback
// the moment the segment is ready), so the floor has to live on the segment.
// Runs concurrently with the auth check, so it only adds latency when the check
// finishes in under a second.
const MIN_LOADING_MS = 1000;

export default async function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await Promise.all([
    requireSession(),
    new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS)),
  ]);
  return children;
}
