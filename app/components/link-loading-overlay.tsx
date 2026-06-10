'use client';

import { useEffect, useRef, useState } from 'react';
import { useLinkStatus } from 'next/link';
import { Loader2 } from 'lucide-react';

// Minimum time the overlay stays on screen once a navigation begins, so fast
// transitions don't flash the spinner away before the destination has rendered.
const MIN_VISIBLE_MS = 2000;

// Full-screen centered spinner shown while its parent <Link> navigation is
// pending. Must be a descendant of a Next.js <Link>; `useLinkStatus` reads that
// link's in-flight navigation state and stays pending for the entire navigation
// (including the destination's server render), so the overlay covers the whole
// page transition. The `fixed` overlay escapes the inline link in the layout,
// so it works inside nav links and `<Button asChild>` links alike.
//
// On top of `pending`, a MIN_VISIBLE_MS floor keeps the overlay up long enough
// to be perceptible: it hides at max(MIN_VISIBLE_MS, actual navigation time).
export function LinkLoadingOverlay() {
  const { pending } = useLinkStatus();
  const [visible, setVisible] = useState(false);
  const [wasPending, setWasPending] = useState(pending);
  const startedAt = useRef(0);

  // Show immediately when navigation starts (adjust-state-during-render pattern;
  // kept pure — the start timestamp is recorded in the effect below).
  if (pending !== wasPending) {
    setWasPending(pending);
    if (pending) setVisible(true);
  }

  // Record the navigation start while pending; once it finishes, hide only after
  // the minimum-visible floor elapses, so total = max(MIN_VISIBLE_MS, load time).
  useEffect(() => {
    if (pending) {
      startedAt.current = Date.now();
      return;
    }
    if (!visible) return;
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt.current));
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [pending, visible]);

  if (!visible) return null;

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
