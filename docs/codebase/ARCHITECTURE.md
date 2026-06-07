# Architecture

## Core Sections (Required)

### 1) Architectural Style

- Primary style: **Layered monolith on Next.js App Router** — thin HTTP route handlers orchestrate a set of pure domain modules (`lib/`), with S3 as the only datastore. Server components read data directly; the only client→server API surface is parse/summarize/statements.
- Why this classification: domain logic lives in side-effect-free `lib/` modules (`aggregations.ts`, `categorize.ts`, `period.ts`, `dashboard-aggregations.ts`, `summary-payload.ts`), all I/O is isolated to `lib/storage.ts` and `lib/gemini.ts`, and routes only translate HTTP↔domain. Evidence: module headers explicitly state "pure / no I/O" (`lib/aggregations.ts:1-7`, `lib/dashboard-aggregations.ts:1-9`).
- Primary constraints (baked into `CLAUDE.md`):
  1. **PCI hygiene** — PAN masked to `cardLast4` at the parser boundary (`lib/parsers/tpbank.ts:230-236`); never logged/stored/sent.
  2. **AI gets aggregates only** — `/api/summarize` strips to anonymized totals via `buildSummaryPayload()` before the Gemini prompt (`lib/summary-payload.ts`).
  3. **URL is the source of truth for period state** — dashboard reads `searchParams`, no client state (`app/page.tsx:15-27`).
  4. **Zod at every boundary** — parser output and S3 reads validated (`lib/schemas.ts`, `lib/storage.ts:115`).

### 2) System Flow

```text
Upload (client) → POST /api/parse (nodejs runtime)
  → auth gate (requireApiSession)
  → parseTPBankStatement(buffer, PDF_PASSWORD)   [pdf-parse → regex → mask PAN]
  → categorize() + normalizeMerchant()
  → StatementSchema.parse()                        [Zod boundary]
  → statementExists()/saveStatement() → S3 PUT     [key = statements/{last4}/{yr}/{yr}-{mm}.json]
  → JSON Statement back to client

Dashboard render: GET / (server component, force-dynamic)
  → requireSession() (redirect if unauth)
  → getAllStatements() → S3 LIST + parallel GETs
  → aggregate(statements, periodSpec)              [pure rollup]
  → <Dashboard view={...}>

AI summary: client POSTs AggregatedView → /api/summarize
  → AggregatedViewSchema.safeParse()               [Zod boundary]
  → buildSummaryPayload()                           [anonymize]
  → streamSummary() → Gemini 2.5 Flash → ReadableStream → client
```

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| Route handlers (`app/api/*`) | Auth gating, status codes, request/response shaping, error mapping | Domain math, S3 SDK details | `app/api/parse/route.ts`, `app/api/summarize/route.ts` |
| Parser (`lib/parsers/tpbank.ts`) | PDF→`Statement`, PAN masking, VND parsing, section tallying | Storage, network, categorization rules table | `lib/parsers/tpbank.ts` |
| Categorization (`lib/categorize.ts`) | Merchant→category rules, name normalization | I/O, persistence | `lib/categorize.ts` |
| Aggregation (`lib/aggregations.ts`, `lib/dashboard-aggregations.ts`) | Pure period rollups, category/merchant/trend buckets | I/O, React | `lib/aggregations.ts:1-7` |
| Storage (`lib/storage.ts`) | S3 CRUD, key derivation, auth-error classification, lazy client | Parsing, UI | `lib/storage.ts` |
| Anonymizer (`lib/summary-payload.ts`) | Strip to safe aggregates for Gemini | Sending raw txns/PII | `lib/summary-payload.ts:1-13` |
| Auth (`auth.ts`, `lib/require-session.ts`, `lib/auth-allowlist.ts`) | Single-user allowlist gate, server-side session checks | Business data access | `auth.ts`, `lib/require-session.ts` |
| UI (`app/components/`, `components/ui/`) | Rendering charts/tables/cards | Direct S3/Gemini calls | `app/components/dashboard.tsx` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Lazy singleton (cached S3 client) | `lib/storage.ts:66-74` | Validating env at module load would break `next build`; defer to first call |
| Boundary validation (Zod) | `lib/schemas.ts`, used in `tpbank.ts:339`, `storage.ts:115`, `summarize/route.ts:63` | Trust types only after parse |
| Pure functions + reuse | `lib/aggregations.ts` reuses `lib/dashboard-aggregations.ts` helpers | Single source of filter rules; testable |
| Guard helper returning early `Response` | `requireApiSession()` in every API route | Uniform 401 JSON for fetch callers |
| Defense-in-depth auth | `lib/require-session.ts` (server) + `proxy.ts` (best-effort) | Amplify doesn't run Next 16 proxy middleware, so gate lives in server code |
| Polyfill-before-import | `import '@/lib/pdf-dom-polyfill'` first in `tpbank.ts` + `instrumentation.ts` | pdfjs needs `DOMMatrix` at module-eval time on Amplify Lambda |
| Discriminated union for state | `PeriodSpec` (`lib/period.ts:14-17`) | URL-encodable month/quarter/year period |

### 5) Known Architectural Risks

- **S3 list is unpaginated** — `listStatements()` returns ≤1000 keys, pagination intentionally unhandled (`lib/storage.ts:125`). Fine at personal scale; would silently truncate at >1000 statements.
- **`getAllStatements()` fan-out** — LIST then parallel GET of every statement on each dashboard render (`force-dynamic`, no caching) (`lib/storage.ts:146-149`, `app/page.tsx:12`). Cost/latency grows linearly with statement count.
- **Amplify SSR runtime gotchas** — env vars must be hand-injected into `.env.production` (`amplify.yml:15`); SSR uses the compute IAM role (not service role) for S3; Next 16 proxy middleware is never deployed, so auth must be server-side. A region mismatch causes silent S3 GET failures.
- **pdfjs on Lambda** — the parse path depends on a hand-written `DOMMatrix` polyfill and a post-build worker copy step (`scripts/copy-pdf-worker.mjs`); a pdfjs upgrade could reintroduce the opaque-500 failure mode (high churn on `app/api/parse/route.ts`).

### 6) Evidence

- `app/page.tsx`, `app/api/parse/route.ts`, `app/api/summarize/route.ts`
- `lib/parsers/tpbank.ts`, `lib/aggregations.ts`, `lib/storage.ts`, `lib/summary-payload.ts`
- `CLAUDE.md` (architectural conventions), `amplify.yml`, `instrumentation.ts`
