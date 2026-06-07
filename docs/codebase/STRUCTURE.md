# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `app/` | Next.js App Router — pages, API routes, React components | `app/page.tsx`, `app/api/`, `app/components/` |
| `app/api/` | Route handlers: `parse/`, `summarize/`, `statements/`, `statements/[id]/`, `auth/[...nextauth]/` | scan tree lines 21-30 |
| `app/components/` | Feature/UI components (dashboard, charts, upload, nav, KPI) | scan tree 31-47 |
| `components/ui/` | shadcn/ui primitives (button, card, table, tabs, badge…) | `components.json`, scan tree 62-71 |
| `lib/` | Domain logic: parser, categorizer, schemas, storage, aggregations, gemini, auth helpers | scan tree 102-129 |
| `lib/parsers/` | `tpbank.ts` — the deterministic statement parser | `lib/parsers/tpbank.ts` |
| `lib/__tests__/` | Vitest unit + fixture-acceptance suites | scan tree 103-112 |
| `terraform/` | IaC: S3, Cognito, Amplify, IAM, GitHub OIDC, remote-state backend | `terraform/*.tf` |
| `scripts/` | CLI utilities (parser tester, S3 diag/cleanup, pdfjs worker copy) | scan tree 143-148 |
| `docs/plans/` | Numbered implementation plan (`00-INDEX.md` … `19-*.md`) — the build spec | scan tree 79-99 |
| `docs/` | `DEPLOYMENT.md`, `auth-setup-todo.md`, `codebase/` (this doc set) | scan tree 73-78 |
| `test-pdfs/` | Gitignored sample statement fixtures | scan tree 169-171 |
| `public/` | Static SVG assets | scan tree 137-142 |
| Root configs | `auth.ts`, `proxy.ts`, `instrumentation.ts`, `next.config.ts`, `amplify.yml` | repo root |

### 2) Entry Points

- Main runtime entry: `app/page.tsx` (dashboard server component) and the route handlers under `app/api/`.
- Startup hook: `instrumentation.ts` `register()` runs once at server boot to install pdfjs DOM polyfills.
- Auth config entry: `auth.ts` exports `handlers`/`auth`/`signIn`/`signOut`, wired into `app/api/auth/[...nextauth]/`.
- Secondary entry points: `scripts/*.ts` (run via `tsx`), `proxy.ts` (Next 16 renamed middleware — best-effort, not run on Amplify).
- How entry is selected: Next.js App Router file-system routing; `package.json` scripts for build/dev/test.

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| `lib/parsers/tpbank.ts` | Regex extraction, PAN masking, VND number parsing | Persistence, network, LLM calls |
| `lib/categorize.ts`, `lib/aggregations.ts`, `lib/dashboard-aggregations.ts`, `lib/period.ts` | Pure functions (no I/O, no mutation) | S3/HTTP/logging, React |
| `lib/storage.ts` | All S3 access + auth-error classification | Parsing, categorization, UI |
| `lib/summary-payload.ts` | Strip `AggregatedView` to anonymized aggregates | Card numbers, raw txn descriptions/dates |
| `lib/schemas.ts` | Zod boundary schemas + inferred types | Business logic |
| `app/api/*/route.ts` | HTTP orchestration, status codes, auth gating | Pure domain math (delegated to `lib/`) |
| `app/components/` | Rendering | S3/Gemini direct calls (data arrives via props/fetch) |

### 4) Naming and Organization Rules

- File naming: kebab-case for modules and components (`ai-summary-card.tsx`, `dashboard-aggregations.ts`); Next.js reserved names (`page.tsx`, `route.ts`, `layout.tsx`, `loading.tsx`, `error.tsx`).
- Directory organization: layer-based under `lib/` (parsers, schemas, storage, aggregations), feature/route-based under `app/`.
- Import aliasing: `@/*` maps to repo root (`tsconfig.json:21-23`, mirrored in `vitest.config.ts:6-8`). Used pervasively, e.g. `import { categorize } from '@/lib/categorize'`.

### 5) Evidence

- `docs/codebase/.codebase-scan.txt` (DIRECTORY TREE)
- `tsconfig.json`, `vitest.config.ts` (path alias)
- `app/page.tsx`, `instrumentation.ts`, `auth.ts`
