import { Loader2 } from 'lucide-react';

// Full-screen centered spinner shared by the in-navigation <LinkLoadingOverlay>
// and route-level loading.tsx files, so every loading state looks identical.
// No hooks — safe to render from server components (e.g. loading.tsx).
export function LoadingSpinner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
    >
      <Loader2 className="h-12 w-12 animate-spin text-primary" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
