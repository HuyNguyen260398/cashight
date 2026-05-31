# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repo contains **Cashight**, a personal expense tracker. The numbered markdown files (`00-INDEX.md` through `11-amplify-deployment.md`) are the build instructions; `00-INDEX.md` is the entry point and shows the step dependency graph.

Step 01 (`01-project-setup.md`) creates the Next.js app at the repo root via `pnpm create next-app`. Once that runs, application code lives at the repo root alongside these plan files (not in a subdirectory — Step 01 uses `--no-src-dir` and scaffolds `app/`, `lib/`, etc. directly).

When the user asks to "start", "do step N", or "continue", treat the relevant `NN-*.md` file as the authoritative spec for that unit of work — its **Tasks**, **Files affected**, and **Acceptance criteria** sections are the contract. Do not skip steps out of order: dependencies between steps are listed in `00-INDEX.md`.

## What you're building

A personal Next.js 15 web app that:
1. Parses **TPBank Vietnamese credit card PDF statements** with a deterministic regex parser (no LLM in the parse path).
2. Categorizes transactions via a rule table, then renders a dashboard (KPI cards, category donut, top-merchants bar, daily-spend area, transactions table).
3. Streams a Gemini-generated natural-language summary of the month's spending.
4. Persists statements to S3 keyed by `statements/{cardLast4}/{year}/{year}-{mm}.json`.
5. Aggregates across statements for month / quarter / year views, with the period in the URL (`?period=quarter&year=2026&quarter=2`).
6. Deploys to AWS Amplify Hosting (SSR) in `ap-southeast-1`.

## Commands (available once Step 01 has run)

| Task | Command |
|---|---|
| Dev server | `pnpm dev` |
| Production build | `pnpm build` |
| Type check | `pnpm tsc --noEmit` |
| Test the parser against the sample PDF | `pnpm tsx scripts/test-parser.ts` |
| Unit tests (added in Step 08) | `pnpm test` (vitest) |
| Run a single vitest file | `pnpm test lib/__tests__/aggregations.test.ts` |
| Terraform (from `terraform/`, added Step 06) | `terraform init` / `terraform plan` / `terraform apply` |

`pnpm` is pinned via `packageManager` in `package.json` so Amplify uses the same version — keep it in sync with what Step 01 set.

## Architectural conventions baked into the plan

These cut across multiple steps; deviating from them means rewriting later steps.

- **PCI hygiene.** Mask the card number to `cardLast4` **immediately** after PDF extraction. The full PAN must never appear in any log, any API response, any storage key, or any payload sent to Gemini. The parser must enforce this at its boundary.
- **AI gets aggregates only.** `/api/summarize` receives the parsed `Statement` or `AggregatedView` from the client, but the route strips it to anonymized totals/top-categories/top-merchants via `buildSummaryPayload()` before constructing the Gemini prompt. Raw transaction descriptions, names, and card numbers must not be sent.
- **`pdf-parse` requires the Node runtime.** Any route that imports it must export `runtime = 'nodejs'`. Edge runtime breaks it.
- **Vietnamese number format.** TPBank uses `.` as the thousands separator: `17.184.741` is seventeen million, not seventeen. Strip dots before `parseInt`. The parser is the only place that does this conversion.
- **Zod at the boundary.** `StatementSchema.parse()` validates both the parser's output and anything read from S3 — treat the inferred types as trustworthy only after validation.
- **URL is the source of truth for period state.** The dashboard is a server component that reads `searchParams`; do not put period selection in React context or `useState`. This is what makes the view shareable and survives refresh.
- **Force-dynamic on data-reading pages.** `app/page.tsx` and statements API routes use `export const dynamic = 'force-dynamic'` because S3 content can change between requests.
- **Storage key derivation is the dedupe mechanism.** Key = `statements/{cardLast4}/{year}/{year}-{mm}.json`. Re-uploading the same month overwrites; S3 versioning (90-day expiry) preserves the prior version. There is no separate ID generation.
- **Aggregation functions are pure.** `lib/aggregations.ts` and `lib/dashboard-aggregations.ts` return new objects, take no I/O. The Step 08 vitest suite is the correctness baseline — update it when changing aggregation logic.
- **Region is `ap-southeast-1` everywhere.** S3 bucket, Amplify app, and `AWS_REGION` env var must agree. Mismatched regions cause silent S3 GET failures in production.
- **Installments are accounted separately.** They are a large chunk of the statement; the plan deliberately keeps `totalSpend` and `totalInstallments` distinct rather than double-counting. The dashboard decides how to display them.

## Data flow

```
PDF upload
  → /api/parse (Node runtime)
  → lib/parsers/tpbank.ts (regex → raw shape)
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

Set in `.env.local` for dev (gitignored) and in the Amplify Console for production:

- `GEMINI_API_KEY` — from Google AI Studio
- `STATEMENTS_BUCKET` — from `terraform output statements_bucket_name`
- `AWS_REGION=ap-southeast-1`

The app **crashes at startup if `STATEMENTS_BUCKET` is unset** — this is intentional, do not add fallback logic.

## Sample PDF for parser development

`test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf` is the canonical fixture. The directory is gitignored. Known acceptance numbers for the May 2026 statement (used in Step 02 / Step 08 tests):

- `cardLast4 === '9674'`
- `totals.statementBalance === 37978402`
- `totals.totalSpend === 26986712`
- `totals.totalCashback === 519020`
- `transactions.length ≈ 27`
