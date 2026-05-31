# Step 13 — Dark / Light Mode Toggle

> Wire up `next-themes` (already a dependency) and add a header toggle. The `.dark` CSS tokens already exist in `app/globals.css`, so this is mostly plumbing.

**Estimated effort:** 30–45 minutes
**Prerequisites:** Step 12
**Phase:** 4 — Pre-deployment feature pass

---

## Goal

The user can switch between light, dark, and system themes from a control in the header. The choice persists across reloads and there is no hydration flash or React hydration warning.

## Tasks

### 1. Theme provider wrapper — `app/components/theme-provider.tsx` (create)

A thin client wrapper around `next-themes`:

```tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
```

### 2. Wire it into the layout — `app/layout.tsx` (modify)

- Add `suppressHydrationWarning` to the `<html>` element (next-themes sets the `class` attribute on the client, which otherwise trips the warning).
- Wrap the page body content in:
  ```tsx
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    {/* header + {children} + <Toaster /> */}
  </ThemeProvider>
  ```
- Keep the existing `<Toaster />`.

### 3. Toggle control — `app/components/theme-toggle.tsx` (create)

- A `Button` (use `variant="ghost"`, `size="icon"`) with lucide `Sun` / `Moon` icons (lucide-react is already installed).
- Read/set theme with `useTheme()` from `next-themes`.
- **Mounted guard:** `useTheme()` is undefined on the server, so render a placeholder (or nothing) until a `useState(false)` + `useEffect(() => setMounted(true))` flips — this avoids a hydration mismatch.
- Toggle behavior: cycle/flip between `'light'` and `'dark'` (simplest: `setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')`).

### 4. Place the toggle in the header nav — `app/layout.tsx`

Add `<ThemeToggle />` to the right side of the existing `<nav>` (e.g. wrap the links in a flex container and push the toggle with `ml-auto`).

## Files affected

- `app/components/theme-provider.tsx` — **create**
- `app/components/theme-toggle.tsx` — **create**
- `app/layout.tsx` — modify (provider wrap + `suppressHydrationWarning` + toggle in nav)

## Acceptance criteria

- Toggle in the header switches the whole UI between light and dark; cards, charts, and badges all respond (they use the CSS tokens already).
- Reload the page — the chosen theme persists (next-themes writes `localStorage`).
- First paint matches the chosen/system theme (no white flash in dark mode).
- No "hydration mismatch" warning in the browser console.
- `pnpm build` and `pnpm lint` pass.

## Notes & gotchas

- **Don't** add new theme CSS — `:root` and `.dark` token blocks already exist in `globals.css`. Recharts components read the `--chart-*` / `--primary` tokens, so they recolor automatically.
- The mounted guard is the part people forget; without it the icon flickers and the console warns.
- `disableTransitionOnChange` prevents a jarring color-transition sweep when toggling.

## Next step

[Step 14 — Transactions category filter](./14-transactions-category-filter.md)
