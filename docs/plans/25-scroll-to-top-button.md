# Step 25 — Scroll-to-Top Floating Button

> Add a floating button that appears after the user scrolls down and smooth-scrolls back to the top. Available on every page.

**Estimated effort:** 20–30 minutes
**Prerequisites:** Step 01 (app layout exists)
**Phase:** 7 — Dashboard UX refinements

---

## Goal

A fixed bottom-right button is hidden at the top of the page, appears once the user scrolls past ~300px, and smooth-scrolls to the top on click. It's mounted once in the root layout so it works on the dashboard, Statements, and Upload pages.

## Tasks

1. **Create `app/components/scroll-to-top.tsx`** as a `'use client'` component:
   ```tsx
   'use client';

   import { useEffect, useState } from 'react';
   import { ArrowUp } from 'lucide-react';
   import { Button } from '@/components/ui/button';

   export function ScrollToTop() {
     const [visible, setVisible] = useState(false);

     useEffect(() => {
       const onScroll = () => setVisible(window.scrollY > 300);
       onScroll();
       window.addEventListener('scroll', onScroll, { passive: true });
       return () => window.removeEventListener('scroll', onScroll);
     }, []);

     if (!visible) return null;

     return (
       <Button
         size="icon"
         aria-label="Scroll to top"
         onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
         className="fixed bottom-6 right-6 z-50 rounded-full shadow-lg"
       >
         <ArrowUp className="h-5 w-5" />
       </Button>
     );
   }
   ```

2. **Mount it in `app/layout.tsx`** — render `<ScrollToTop />` inside `<body>`, after `{children}` (and after any existing providers/toaster), so every route gets it.

## Files affected

- `app/components/scroll-to-top.tsx` — create
- `app/layout.tsx` — modify (mount the button once)

## Acceptance criteria

- The button is not visible at the top of any page.
- After scrolling > 300px on the dashboard, Statements, and Upload pages, it appears bottom-right.
- Clicking it smooth-scrolls to the top.
- It has `aria-label="Scroll to top"` and does not overlap critical content (toaster, dialogs) in a disruptive way.
- `pnpm build` and `pnpm lint` pass.

## Notes & gotchas

- The component is client-only; mounting it in the server `layout.tsx` is fine — Next renders the client island where it's placed.
- Use the `{ passive: true }` scroll listener and clean it up in the effect return to avoid leaks.
- If the button should **not** appear on `/signin`, gate it there (e.g. read `usePathname()` and return `null`), but by default global mounting is acceptable for this single-user app.

## Commits

One commit per task (see the Git workflow note in [`00-INDEX.md`](./00-INDEX.md)). The component builds standalone; mounting it wires it into every route.

| Commit | Covers | Message |
|--------|--------|---------|
| 1 | Task 1 | `feat(ui): add ScrollToTop floating button component` |
| 2 | Task 2 | `feat(layout): mount scroll-to-top button app-wide` |

## Next step

[Step 26 — Per-page loading skeletons](./26-per-page-loading-skeletons.md)
