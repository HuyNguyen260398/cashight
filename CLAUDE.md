# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repo contains **Cashight**, a personal expense tracker. The application is **built and deployed** (AWS Amplify SSR). Application code lives at the repo root — `app/`, `lib/`, `components/`, etc. (no `src/` dir; scaffolded with `--no-src-dir`).

The numbered markdown files in [`docs/plans/`](./docs/plans/) (`00-INDEX.md` through `19-*.md`) are the original incremental build instructions; `docs/plans/00-INDEX.md` is the entry point and shows the step dependency graph. They document how the app was built and remain the spec of record for each unit of work.

Architecture documentation generated from the current codebase lives in [`docs/codebase/`](./docs/codebase/) (stack, structure, architecture, conventions, integrations, testing, concerns, diagrams).

When the user asks to "start", "do step N", or "continue", treat the relevant `docs/plans/NN-*.md` file as the authoritative spec for that unit of work — its **Tasks**, **Files affected**, and **Acceptance criteria** sections are the contract. Do not skip steps out of order: dependencies between steps are listed in `docs/plans/00-INDEX.md`.

## What you're building

A personal Next.js 16 (App Router, React 19) web app that:
1. Parses **Vietnamese credit card PDF statements from TPBank and VIB** with deterministic parsers (no LLM in the parse path). The issuing bank is auto-detected from marker strings in the extracted text; TPBank uses regex over `pdf-parse` line text, VIB uses coordinate-based layout extraction. Supports password-protected PDFs via the PDF password secret.
2. Categorizes transactions via a rule table, then renders a dashboard (KPI cards, category donut, top-merchants bar, spending trend, installment area chart, transactions table with category filter).
3. Streams a Gemini-generated natural-language summary of the month's spending.
4. Persists statements to S3 keyed by `statements/{cardLast4}/{year}/{year}-{mm}.json`.
5. Aggregates across statements for month / quarter / year views, with the period in the URL (`?period=quarter&year=2026&quarter=2`).
6. Gates all access behind single-user authentication (Auth.js v5: Google + AWS Cognito, one allowlisted email), with a light/dark theme toggle.
7. Deploys to AWS Amplify Hosting (SSR) in `ap-southeast-1`.

## Commands

| Task | Command |
|---|---|
| Dev server | `pnpm dev` |
| Local API stack (no AWS, no Cognito) | `pnpm dev:local` — see [`docs/local-development.md`](./docs/local-development.md) |
| Wipe local stack data | `pnpm dev:local:reset` |
| Production build | `pnpm build` |
| Type check | `pnpm tsc --noEmit` |
| Lint | `pnpm lint` |
| Test the parser against the sample PDF | `pnpm tsx scripts/test-parser.ts` |
| Unit tests | `pnpm test` (vitest) |
| Run a single vitest file | `pnpm test lib/__tests__/aggregations.test.ts` |
| Terraform (from `terraform/`) | `terraform init` / `terraform plan` / `terraform apply` |

`pnpm` is pinned to `11.2.2` via `packageManager` in `package.json` so Amplify uses the same version — keep it in sync.

## Architectural conventions baked into the plan

These cut across multiple steps; deviating from them means rewriting later steps.

- **PCI hygiene.** Mask the card number to `cardLast4` **immediately** after PDF extraction. The full PAN must never appear in any log, any API response, any storage key, or any payload sent to Gemini. The parser must enforce this at its boundary.
- **AI gets aggregates only.** `/api/summarize` receives the parsed `Statement` or `AggregatedView` from the client, but the route strips it to anonymized totals/top-categories/top-merchants via `buildSummaryPayload()` before constructing the Gemini prompt. Raw transaction descriptions, names, and card numbers must not be sent.
- **`pdf-parse` requires the Node runtime.** Any route that imports it must export `runtime = 'nodejs'`. Edge runtime breaks it.
- **Bank knowledge lives in `packages/domain/src/banks.ts`** — codes, short names, detection markers, `DEFAULT_BANK`, and `?bank=` URL parsing. Adding a bank means adding a profile there plus a parser; nothing else should hard-code a bank name.
- **The dashboard views exactly one bank.** There is no combined view — totals from different cards do not add up to anything meaningful. `parseBankFromSearch()` returns `null` when `?bank=` is absent or unrecognised, meaning "not chosen"; `aggregate()` then calls `resolveBank()` to pick one that actually has statements in the period (preferring `DEFAULT_BANK`), and reports the choice back as `selectedBank`. **The resolution must stay server-side** — which banks have data is only knowable after loading the period's statements, so URL parsing cannot decide it. The UI renders the dropdown from `selectedBank`, so the highlighted bank always matches the numbers on screen. An explicit `?bank=` is always honoured, even when that bank has no statements that period.
- **`availableBanks` is computed before the bank filter**, so the dropdown keeps offering the other banks in the period. `BankSelector` also always lists its `current` bank — Radix renders a blank trigger when the value has no matching item.
- **Both selectors preserve each other's URL params.** `PeriodSelector` starts from the current query string (clearing stale `month`/`quarter`) so the bank filter survives a period change, and `BankSelector` preserves the period.
- **Vietnamese number format is per-bank.** TPBank uses `.` as the thousands separator (`17.184.741` is seventeen million); VIB uses `,` with a `.` decimal (`5,591,567.00`). Each conversion lives only in that bank's parser module — `parsers/tpbank.ts` and `parsers/vib-fields.ts` respectively. Do not spread it elsewhere.
- **VIB descriptions embed PII** — a masked PAN, the card-account number, and the cardholder's name. `scrubVibDescription()` strips them at the parser boundary, before the text reaches storage or the Gemini payload.
- **The VIB parser reconciles against the statement's own total-debit figure** (`Phát sinh nợ trong kỳ`) and throws when the per-row tally disagrees. A layout change fails loudly instead of silently storing wrong numbers.
- **The DOM polyfill import must precede any `pdfjs-dist` or `pdf-parse` import** in the same module. pdfjs references `DOMMatrix` while its module body evaluates; getting this wrong crashes at import time, and only in the bundled Lambda. `lib/__tests__/pdf-dom-polyfill.test.ts` asserts the source order.
- **`dist/lambdas/parser-worker/pdf.worker.mjs` is required at runtime** by the bundled pdfjs. `scripts/build-lambdas.mjs` copies it; do not drop that step.
- **Zod at the boundary.** `StatementSchema.parse()` validates both the parser's output and anything read from S3 — treat the inferred types as trustworthy only after validation.
- **URL is the source of truth for period state.** The dashboard is a server component that reads `searchParams`; do not put period selection in React context or `useState`. This is what makes the view shareable and survives refresh.
- **Force-dynamic on data-reading pages.** `app/page.tsx` and statements API routes use `export const dynamic = 'force-dynamic'` because S3 content can change between requests.
- **Storage key derivation is the dedupe mechanism.** Key = `statements/{cardLast4}/{year}/{year}-{mm}.json`. Re-uploading the same month overwrites; S3 versioning (90-day expiry) preserves the prior version. There is no separate ID generation.
- **Aggregation functions are pure.** `lib/aggregations.ts` and `lib/dashboard-aggregations.ts` return new objects, take no I/O. The Step 08 vitest suite is the correctness baseline — update it when changing aggregation logic.
- **Region is `ap-southeast-1` everywhere.** S3 bucket, Amplify app, and the region env var (`STORAGE_REGION` in prod, `AWS_REGION` in dev) must agree. Mismatched regions cause silent S3 GET failures in production.
- **Installments are accounted separately.** They are a large chunk of the statement; the plan deliberately keeps `totalSpend` and `totalInstallments` distinct rather than double-counting. The dashboard decides how to display them.

## Data flow

```
PDF upload
  → /api/parse (Node runtime)
  → parsers/pdf-text.ts extractPdfText() (tries each candidate password)
  → banks.ts detectBank() → parsers/index.ts routes on the result
      TPBank → parsers/tpbank.ts    (regex over line text)
      VIB    → parsers/vib.ts       (coordinate-based layout rows)
      neither → UnsupportedBankError → job errorCode UNSUPPORTED_BANK
  → lib/categorize.ts (rule table)
  → StatementSchema.parse() (Zod validation)
  → lib/storage.ts saveStatement() (S3 PUT)
  → response: validated Statement

Dashboard render (server component)
  → lib/storage.ts getAllStatements() (S3 LIST + parallel GETs)
  → lib/aggregations.ts aggregate(statements, periodSpec)
  → AggregatedView passed to <Dashboard>

AI summary
  → client posts Statement/AggregatedView to /api/summarize
  → lib/summary-payload.ts buildSummaryPayload() strips to anonymized aggregates
  → lib/gemini.ts streamSummary() → Gemini 2.5 Flash
  → ReadableStream back to client
```

## Environment variables

Set in `.env.local` for dev (gitignored) and in the Amplify Console for production. See `.env.example` for the full annotated list.

- `GEMINI_API_KEY` — from Google AI Studio
- `STATEMENTS_BUCKET` — from `terraform output statements_bucket_name`
- `STORAGE_REGION` / `AWS_REGION` — `ap-southeast-1`. Prod uses `STORAGE_REGION` because Amplify reserves the `AWS_*` prefix; dev can use `AWS_REGION`. (`lib/storage.ts:getStorageRegion`)
- `PDF_PASSWORD` — optional; unlocks password-protected statement PDFs (server-only). In production the Secrets Manager value may instead be a JSON map of candidate passwords, one per bank: `{"TPB":"…","VIB":"…"}`. **The keys are labels only** — every value is tried in turn, because the PDF must be decrypted before its bank can be detected. A plain string is still accepted as a single password. Locally, `PDF_PASSWORDS` holds the same JSON and takes precedence over `PDF_PASSWORD`.
- `AUTH_SECRET` — Auth.js session secret (`npx auth secret`)
- `ALLOWED_EMAIL` — the single account permitted to sign in
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth client
- `AUTH_COGNITO_ID` / `AUTH_COGNITO_SECRET` / `AUTH_COGNITO_ISSUER` — Cognito app client (from `terraform output`)

The app **crashes on the first S3 call if `STATEMENTS_BUCKET` is unset** — this is intentional, do not add fallback logic.

## Sample PDFs for parser development

`test-pdfs/` is gitignored, so fixture-dependent vitest suites self-skip in CI. Both fixtures are verified by `scripts/test-parser.ts`.

**TPBank** — `test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf`, May 2026:

- `cardLast4 === '9674'`
- `totals.statementBalance === 37978402`
- `totals.totalSpend === 26986712`
- `totals.totalCashback === 519020`
- `transactions.length === 41`

**VIB** — `test-pdfs/vib_saoke_07_2026_4550.pdf`, July 2026 (password-protected; pass it via `VIB_PDF_PASSWORD` when running the script):

- `bank === 'VIB'`, `cardLast4 === '4550'`
- `statementDate === '2026-07-25'`, `paymentDueDate === '2026-08-10'`
- `creditLimit === 124000000`
- `totals.statementBalance === 5591567`, `totals.minimumPayment === 5582360`
- `totals.totalSpend === 0`, `totals.totalInstallments === 5581667`, `totals.totalFeesAndInterest === 9900`
- `transactions.length === 3`

Note this VIB month is a degenerate sample — previous balance, end balance, total debit, and total credit are all `5,591,567.00` — so it cannot catch a label/value mix-up on its own. The parser's debit reconciliation check is the real guard.
