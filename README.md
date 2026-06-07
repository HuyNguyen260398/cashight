# Cashight

**Cashight** is a personal expense tracker that turns **TPBank credit card PDF statements** into a categorized dashboard with an AI-generated spending summary.

Upload a statement, get back KPI cards, category breakdowns, top merchants, and a natural-language overview of where the money went — across one month or rolled up by quarter or year.

## Features

- **Deterministic PDF parser** for TPBank Vietnamese credit card statements — no LLM in the parse path, just regex + Zod validation. Handles **password-protected PDFs** via a `PDF_PASSWORD` decrypt-and-retry.
- **Rule-based categorization** with merchant name normalization (strips locale suffixes, maps known variants to canonical names).
- **Dashboard**: KPI cards, category donut, top-merchants bar, spending trend, installment area chart, and a transactions table with category filtering.
- **AI summary** streamed from Google Gemini (2.5 Flash) using **anonymized aggregates only** — no card numbers, no individual transactions, no PII leaves the server.
- **Multi-period views**: switch between month / quarter / year; the period lives in the URL so views are shareable and survive refresh.
- **S3-backed persistence** with versioning and 90-day retention for prior uploads.
- **Single-user authentication** (Auth.js v5) via Google or AWS Cognito, gated to one allowlisted email.
- **Dark mode** toggle (system / light / dark).
- **Mobile-first responsive layout** designed to work at 390px and up.

## Architecture

```
PDF upload
  → /api/parse              (Node runtime — pdf-parse can't run on Edge)
  → lib/parsers/tpbank.ts   (regex extraction → raw shape, PAN masked here)
  → lib/categorize.ts       (merchant → category rules)
  → StatementSchema.parse() (Zod validation at the boundary)
  → lib/storage.ts          (S3 PUT, key = statements/{cardLast4}/{year}/{year}-{mm}.json)
  → response: validated Statement JSON

Dashboard (server component)
  → lib/storage.ts          (S3 LIST + parallel GETs)
  → lib/aggregations.ts     (pure rollup by month/quarter/year)
  → <Dashboard view={...}>

AI summary
  → /api/summarize
  → lib/summary-payload.ts  (strips to anonymized aggregates)
  → lib/gemini.ts           (Gemini 2.5 Flash, streaming)
  → ReadableStream → client
```

Every request is gated server-side by an Auth.js session check (`lib/require-session.ts`); only the single allowlisted email may sign in.

**Stack**: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Recharts · Zod · `pdf-parse` · `@google/genai` · `@aws-sdk/client-s3` · Auth.js v5 · Terraform · AWS Amplify Hosting (SSR).

**Region**: everything runs in `ap-southeast-1` (Singapore) for proximity to HCMC.

> [!TIP]
> Full architecture documentation lives in [`docs/codebase/`](./docs/codebase/) — stack, structure, conventions, integrations, testing, concerns, and Mermaid diagrams.

## Privacy

> [!IMPORTANT]
> The card PAN is masked to its last 4 digits **at the parser boundary** — the full number is never logged, stored, or transmitted. The Gemini summary endpoint receives only anonymized totals, top categories, and top merchants — never raw transaction descriptions.

## Getting started

### Prerequisites

- Node.js 20+ (CI and Amplify run Node 24)
- [pnpm](https://pnpm.io/) (pinned to `11.2.2` via `packageManager` in `package.json`)
- A [Google AI Studio](https://aistudio.google.com/) API key for Gemini
- AWS account + credentials (for the S3 storage layer)
- A Google OAuth client and/or AWS Cognito user pool (for sign-in)
- Terraform 1.10+ (for provisioning S3, Cognito, IAM, and Amplify)

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Fill in the variables below

# 3. Start the dev server
pnpm dev
```

Visit http://localhost:3000, sign in with the allowlisted account, and drop a TPBank statement PDF on the upload page.

### Common commands

| Task                                | Command                              |
| ----------------------------------- | ------------------------------------ |
| Dev server                          | `pnpm dev`                           |
| Production build                    | `pnpm build`                         |
| Type check                          | `pnpm tsc --noEmit`                  |
| Lint                                | `pnpm lint`                          |
| Run the parser against a local PDF  | `pnpm tsx scripts/test-parser.ts`    |
| Unit tests (Vitest)                 | `pnpm test`                          |
| Provision AWS infra                 | `cd terraform && terraform apply`    |

### Environment variables

Set in `.env.local` for dev (gitignored) and in the Amplify Console for production. See [`.env.example`](./.env.example) for the full annotated list.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key for the summary endpoint |
| `STATEMENTS_BUCKET` | S3 bucket name (from `terraform output statements_bucket_name`) |
| `STORAGE_REGION` | S3 client region; use `ap-southeast-1` in Amplify because `AWS_*` env names are reserved there |
| `AWS_REGION` | `ap-southeast-1` (local dev) |
| `PDF_PASSWORD` | Password to unlock password-protected statement PDFs (server-only; optional) |
| `AUTH_SECRET` | Auth.js session secret — generate with `npx auth secret` |
| `ALLOWED_EMAIL` | The single account permitted to sign in |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client credentials |
| `AUTH_COGNITO_ID` / `AUTH_COGNITO_SECRET` / `AUTH_COGNITO_ISSUER` | AWS Cognito app-client credentials (from `terraform output`) |

> [!WARNING]
> The app crashes at startup if `STATEMENTS_BUCKET` is unset. This is intentional — fail loudly rather than silently misroute data.

## Deployment

The app deploys to **AWS Amplify Hosting** (SSR) in `ap-southeast-1`. Infrastructure (S3 bucket, Cognito user pool, IAM roles, Amplify app, GitHub OIDC) is provisioned with Terraform in [`terraform/`](./terraform/). See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for the full runbook and [`amplify.yml`](./amplify.yml) for the build pipeline.

## Implementation plan

Cashight was built incrementally from a numbered plan. The steps live in [`docs/plans/`](./docs/plans/) — start at [`docs/plans/00-INDEX.md`](./docs/plans/00-INDEX.md) for the dependency graph. The plan now spans the original 11-step MVP through later additions (rebrand, dark mode, category filter, password-protected PDFs, Google/Cognito auth, S3 consolidation).

## Project structure

```
.
├── app/                # Next.js App Router pages, API routes, and components
│   ├── api/parse/      # PDF → Statement
│   ├── api/summarize/  # Anonymized aggregates → Gemini stream
│   ├── api/statements/ # List / fetch / delete persisted statements
│   ├── api/auth/       # Auth.js (NextAuth) handlers
│   ├── components/     # Dashboard, charts, upload, nav
│   └── signin/         # Sign-in page
├── components/ui/      # shadcn/ui primitives
├── lib/
│   ├── parsers/        # TPBank PDF parser
│   ├── schemas.ts      # Zod data model
│   ├── categorize.ts   # Merchant → category rules
│   ├── storage.ts      # S3 abstraction
│   ├── aggregations.ts # Pure month/quarter/year rollups
│   ├── summary-payload.ts # Anonymizer for the AI summary
│   ├── gemini.ts       # Streaming Gemini client
│   └── *               # auth helpers, period, format, polyfills
├── auth.ts             # Auth.js configuration (Google + Cognito)
├── terraform/          # S3 + Cognito + IAM + Amplify
├── scripts/            # CLI parser tester + S3 utilities
└── docs/               # Architecture docs (codebase/), plans/, deployment
```
