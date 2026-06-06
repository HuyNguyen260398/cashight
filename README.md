# Cashight

**Cashight** is a personal expense tracker that turns **TPBank credit card PDF statements** into a categorized dashboard with an AI-generated spending summary.

Upload a statement, get back KPI cards, category breakdowns, top merchants, and a natural-language overview of where the money went — across one month or rolled up by quarter or year.

> [!NOTE]
> This repository is currently a **detailed implementation plan**. The Next.js application is built incrementally by following [`00-INDEX.md`](./00-INDEX.md). See [Roadmap](#roadmap) below.

## Features

- **Deterministic PDF parser** for TPBank Vietnamese credit card statements — no LLM in the parse path, just regex + Zod validation.
- **Rule-based categorization** with merchant name normalization (strips locale suffixes, maps known variants to canonical names).
- **Dashboard**: KPI cards, category donut, top-merchants bar, daily cumulative spend, and a sortable transactions table.
- **AI summary** streamed from Google Gemini using **anonymized aggregates only** — no card numbers, no individual transactions, no PII leaves the server.
- **Multi-period views**: switch between month / quarter / year; the period lives in the URL so views are shareable and survive refresh.
- **S3-backed persistence** with versioning and 90-day retention for prior uploads.
- **Mobile-first responsive layout** designed to work at 390px and up.

## Architecture

```
PDF upload
  → /api/parse              (Node runtime — pdf-parse can't run on Edge)
  → lib/parsers/tpbank.ts   (regex extraction → raw shape)
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

**Stack**: Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui · Recharts · Zod · `pdf-parse` · `@google/genai` · `@aws-sdk/client-s3` · Terraform · AWS Amplify Hosting (SSR).

**Region**: everything runs in `ap-southeast-1` (Singapore) for proximity to HCMC.

## Privacy

> [!IMPORTANT]
> The card PAN is masked to its last 4 digits **at the parser boundary** — the full number is never logged, stored, or transmitted. The Gemini summary endpoint receives only anonymized totals, top categories, and top merchants — never raw transaction descriptions.

## Getting started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (pinned via `packageManager` in `package.json`)
- A [Google AI Studio](https://aistudio.google.com/) API key for Gemini
- AWS account + credentials (for the S3 storage layer in Phase 2)
- Terraform 1.6+ (for provisioning the S3 bucket)

### Setup

The application is scaffolded by following [Step 01](./01-project-setup.md). Once it has run, the workflow is:

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Fill in GEMINI_API_KEY, STATEMENTS_BUCKET, STORAGE_REGION

# 3. Start the dev server
pnpm dev
```

Visit http://localhost:3000 and drop a TPBank statement PDF on the upload page.

### Common commands

| Task                                | Command                              |
| ----------------------------------- | ------------------------------------ |
| Dev server                          | `pnpm dev`                           |
| Production build                    | `pnpm build`                         |
| Type check                          | `pnpm tsc --noEmit`                  |
| Run the parser against a local PDF  | `pnpm tsx scripts/test-parser.ts`    |
| Unit tests (Vitest)                 | `pnpm test`                          |
| Provision S3 + IAM                  | `cd terraform && terraform apply`    |

### Environment variables

| Variable            | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `GEMINI_API_KEY`    | Google AI Studio key for the summary endpoint                |
| `STATEMENTS_BUCKET` | S3 bucket name (from `terraform output statements_bucket_name`) |
| `STORAGE_REGION`    | S3 client region; use `ap-southeast-1` in Amplify because `AWS_*` env names are reserved |
| `AWS_REGION`        | `ap-southeast-1`                                             |

> [!WARNING]
> The app crashes at startup if `STATEMENTS_BUCKET` is unset. This is intentional — fail loudly rather than silently misroute data.

## Roadmap

The build is split into three phases across 11 steps. See [`00-INDEX.md`](./00-INDEX.md) for the full dependency graph.

**Phase 1 — MVP** (single statement, in-memory)
- [Step 01](./01-project-setup.md) — Project scaffolding & Zod schemas
- [Step 02](./02-pdf-parser-and-categorization.md) — TPBank PDF parser + categorization rules
- [Step 03](./03-parse-api-and-upload-ui.md) — `/api/parse` route + upload UI
- [Step 04](./04-dashboard-charts.md) — KPI cards, charts, transactions table
- [Step 05](./05-ai-summary.md) — Gemini summary card

**Phase 2 — Persistence & multi-period views**
- [Step 06](./06-s3-infrastructure.md) — S3 bucket via Terraform
- [Step 07](./07-storage-layer.md) — Storage abstraction + statements CRUD
- [Step 08](./08-aggregation-engine.md) — Monthly / quarterly / yearly rollups
- [Step 09](./09-period-selector.md) — Period selector + multi-period dashboard

**Phase 3 — Polish & deployment**
- [Step 10](./10-polish.md) — Error states, empty states, responsive review
- [Step 11](./11-amplify-deployment.md) — Deploy to AWS Amplify

## Project structure

The repository today contains only the implementation plan. Once Step 01 has run, the layout will be:

```
.
├── app/                # Next.js App Router pages and API routes
│   ├── api/parse/      # PDF → Statement
│   ├── api/summarize/  # Anonymized aggregates → Gemini stream
│   └── api/statements/ # List / fetch / delete persisted statements
├── lib/
│   ├── parsers/        # TPBank PDF parser
│   ├── schemas.ts      # Zod data model
│   ├── categorize.ts   # Merchant → category rules
│   ├── storage.ts      # S3 abstraction
│   ├── aggregations.ts # Pure month/quarter/year rollups
│   └── gemini.ts       # Streaming Gemini client
├── terraform/          # S3 bucket + IAM policy
├── scripts/            # CLI parser tester
└── 00-INDEX.md ...     # Implementation plan
```
