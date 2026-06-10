'use client';

import { useLinkStatus } from 'next/link';
import { Loader2 } from 'lucide-react';

// Full-screen centered spinner shown while its parent <Link> navigation is
// pending. Must be a descendant of a Next.js <Link>; `useLinkStatus` reads that
// link's in-flight navigation state and stays pending for the entire navigation
// (including the destination's server render), so the overlay covers the whole
// page transition. The `fixed` overlay escapes the inline link in the layout.
export function NavLinkStatus() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

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
