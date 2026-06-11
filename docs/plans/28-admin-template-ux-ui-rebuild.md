# Step 28 — Admin template UX/UI rebuild

## Goal

Apply the visual system and dashboard shell from `/Users/huyng/ws/free-nextjs-admin-dashboard-main/` to Cashight while preserving the shipped app's parser, S3 storage, aggregation, auth, AI privacy, and route behavior.

## Prerequisites

- Steps 01–27 are implemented.
- The reference template at `/Users/huyng/ws/free-nextjs-admin-dashboard-main/` is available locally.
- Existing Cashight routes remain the source of truth: `/`, `/upload`, `/statements`, `/signin`, and API routes.

## Approach

Use a direct template adaptation, not a template copy. Recreate the template's admin layout language in Cashight's existing App Router structure:

- Persistent desktop sidebar with icon navigation.
- Sticky top header with page context, theme toggle, user account, and sign out.
- Mobile header with menu drawer behavior.
- Light gray app background, white/dark translucent cards, 2xl panel radius, subtle borders, and compact dashboard spacing.
- Template-style KPI panels, chart cards, upload surface, statements table, and sign-in card.

Do not port unrelated demo routes, fake ecommerce data, notification menus, map widgets, or the template's separate theme/sidebar providers unless Cashight needs an equivalent behavior.

## Tasks

- [x] **28.1 — Theme tokens and global surface**
  - Update `app/globals.css` to add TailAdmin-inspired color, shadow, radius, sidebar, menu, and table utility tokens while preserving shadcn CSS variables.
  - Set the app body to the template's neutral dashboard background in light and dark modes.
  - Keep Tailwind 4 compatibility and avoid raw one-off colors in page components where tokens can be used.

- [x] **28.2 — Admin shell**
  - Replace the current horizontal `Nav` experience with a responsive admin shell using existing routes.
  - Add app-local shell components under `app/components/` for sidebar, header, mobile drawer/backdrop, and page title context as needed.
  - Use `lucide-react` icons for Cashight navigation: Dashboard, Upload, Statements.
  - Preserve `auth()` email display, `signOut()`, `ThemeToggle`, route active states, and unauthenticated sign-in rendering.

- [x] **28.3 — Dashboard layout**
  - Rework `app/page.tsx` and `app/components/dashboard.tsx` into a 12-column admin dashboard grid matching the sample template composition.
  - Keep `PeriodSelector`, empty/error states, and dynamic Node runtime behavior.
  - Arrange content as KPI grid, AI insight panel, spending trend, installments, category, merchants, and transactions with responsive stacking.

- [x] **28.4 — Cards, KPIs, and chart panels**
  - Update shared `components/ui/card.tsx` or app-level card usage to match the template's `rounded-2xl border border-gray-200 bg-white dark:bg-white/[0.03]` treatment.
  - Restyle `KpiCards` with template-style icon wells, label hierarchy, tabular values, and compact helper text.
  - Restyle chart panel headers and body spacing without changing chart data inputs.

- [x] **28.5 — Tables and mobile lists**
  - Update `TransactionsTable` and `StatementsTable` to match the template's table density, header styling, hover states, badges, and action button treatment.
  - Preserve existing sorting, pagination, delete confirmation, and privacy masking.
  - Keep mobile transaction cards readable and aligned to the new surface system.

- [x] **28.6 — Upload, statements, auth, loading, and error surfaces**
  - Rebuild `/upload` with a template-style page header and dropzone panel.
  - Rebuild `/statements` with page header actions and template-style empty/error states.
  - Rebuild `/signin` as a full-width auth layout inspired by the template's auth card while preserving Google and Cognito flows.
  - Align `app/loading.tsx`, `app/error.tsx`, and empty states with the new visual system.

- [x] **28.7 — Verification**
  - Run `pnpm lint`.
  - Run `pnpm tsc --noEmit`.
  - Run `pnpm test`.
  - Run `pnpm build`.
  - Start `pnpm dev` and verify the redesigned app in the browser at desktop and mobile widths.

## Files affected

- `app/globals.css`
- `app/layout.tsx`
- `app/page.tsx`
- `app/loading.tsx`
- `app/error.tsx`
- `app/upload/page.tsx`
- `app/statements/page.tsx`
- `app/signin/page.tsx`
- `app/components/nav.tsx`
- `app/components/nav-links.tsx`
- `app/components/mobile-nav.tsx`
- `app/components/theme-toggle.tsx`
- `app/components/dashboard.tsx`
- `app/components/kpi-cards.tsx`
- `app/components/ai-summary-card.tsx`
- `app/components/upload-dropzone.tsx`
- `app/components/transactions-table.tsx`
- `app/components/statements-table.tsx`
- `app/components/empty-state.tsx`
- `app/components/empty-period-state.tsx`
- `components/ui/card.tsx`
- `components/ui/table.tsx`
- `components/ui/button.tsx`
- New app-local shell components under `app/components/` if needed.

## Acceptance criteria

- The app visually resembles `/Users/huyng/ws/free-nextjs-admin-dashboard-main/` in layout, spacing, panels, sidebar/header, and light/dark surfaces.
- Cashight still exposes only its existing product routes and actions.
- The sidebar and header work on desktop and mobile.
- `Dashboard`, `Upload`, and `Statements` navigation maintains active states and deep links.
- Dashboard period selection remains URL-driven.
- Upload still parses and saves statements through `/api/parse`.
- Statements still sort, paginate, link to periods, and delete with confirmation.
- Sign-in still supports Google and Cognito and shows access errors.
- No raw card numbers, raw transaction descriptions, secrets, `PDF_PASSWORD`, or full PANs are introduced into logs, AI payloads, storage keys, or new UI surfaces beyond existing transaction table display.
- `pnpm lint`, `pnpm tsc --noEmit`, `pnpm test`, and `pnpm build` pass.

## Notes & gotchas

- Do not import template files wholesale if they bring unused demo features or separate route assumptions.
- Keep any `pdf-parse` importing routes on `runtime = 'nodejs'`.
- Keep `app/page.tsx` and storage-backed routes dynamic.
- The template's `Outfit` font is optional; if introduced, preserve stable layout and avoid adding unnecessary font variants.
- The template uses `rounded-2xl` cards, but Cashight's existing shadcn components use radius tokens. Prefer a consistent app-level card surface over mixed radii.

## Commits

- `design: plan admin template ux rebuild`
- `style(shell): apply admin sidebar and header`
- `style(dashboard): rebuild dashboard surfaces from admin template`
- `style(pages): align upload statements and auth views`
- `style(tables): align data tables with admin template`

## Next step

Execute Step 28 and verify the app visually and with the full command suite.
