import { Loader2 } from 'lucide-react';

// Full-screen centered loading spinner with a blurred backdrop. Server-safe
// (no hooks), so it can be rendered directly from route-level loading.tsx
// files. Next.js shows it as the Suspense fallback during route navigation;
// the fade-in keeps its appearance smooth rather than an abrupt pop.
export function Spinner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
    >
      <Loader2 className="h-12 w-12 animate-spin text-primary" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
