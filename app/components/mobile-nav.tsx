'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NavLinks } from './nav-links';

// Matches the close animation duration below (and the project's tw-animate-css
// convention) so the panel is unmounted only after the exit animation plays.
const CLOSE_MS = 200;

// Mobile-only navigation: a hamburger button that toggles a full-width dropdown
// panel with the nav links and account actions. Hidden on md+ where the full
// horizontal bar is shown instead (see Nav). The `signOutAction` server action
// is created in the server <Nav> and passed down as a prop.
//
// `open` drives the open/close animation (via data-state); `visible` keeps the
// panel mounted until the exit animation finishes.
export function MobileNav({
  email,
  signOutAction,
}: {
  email?: string | null;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);

  // Close immediately on route change (covers back/forward and link taps) —
  // the page is changing, so no exit animation is needed.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
    setVisible(false);
  }

  function openMenu() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setVisible(true);
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setVisible(false), CLOSE_MS);
  }

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Clear any pending unmount timer on unmount.
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const state = open ? 'open' : 'closed';

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => (open ? closeMenu() : openMenu())}
      >
        {open ? <X /> : <Menu />}
      </Button>

      {visible ? (
        <>
          {/* Tap-outside scrim */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            data-state={state}
            onClick={closeMenu}
            className="fixed inset-0 z-40 cursor-default bg-black/20 duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          />
          <div
            id="mobile-nav-panel"
            data-state={state}
            className="absolute inset-x-0 top-full z-50 origin-top border-b bg-background shadow-md duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2"
          >
            <div className="container mx-auto flex flex-col gap-1 px-4 py-3">
              <NavLinks variant="mobile" onNavigate={closeMenu} />
              {email ? (
                <div className="mt-2 flex items-center justify-between gap-3 border-t pt-3">
                  <span className="truncate text-sm text-muted-foreground">
                    {email}
                  </span>
                  <form action={signOutAction}>
                    <Button type="submit" variant="outline" size="sm">
                      Sign out
                    </Button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
