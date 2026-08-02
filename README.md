<div align="center">

# Cashight

**Personal expense tracker that turns TPBank credit card PDF statements into a categorized dashboard with an AI-generated spending summary.**

<p>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js_16-static_export-000000?logo=nextdotjs&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white">
  <img alt="shadcn/ui" src="https://img.shields.io/badge/shadcn%2Fui-000000?logo=shadcnui&logoColor=white">
  <img alt="Recharts" src="https://img.shields.io/badge/Recharts-22B5BF?logo=chartdotjs&logoColor=white">
  <img alt="Zod" src="https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white">
</p>

<p>
  <img alt="AWS Lambda" src="https://img.shields.io/badge/Lambda-FF9900?logo=awslambda&logoColor=white">
  <img alt="API Gateway" src="https://img.shields.io/badge/API_Gateway-FF4F8B?logo=amazonapigateway&logoColor=white">
  <img alt="CloudFront" src="https://img.shields.io/badge/CloudFront-8C4FFF?logo=amazoncloudfront&logoColor=white">
  <img alt="Amazon S3" src="https://img.shields.io/badge/S3-569A31?logo=amazons3&logoColor=white">
  <img alt="DynamoDB" src="https://img.shields.io/badge/DynamoDB-4053D6?logo=amazondynamodb&logoColor=white">
  <img alt="Amazon SQS" src="https://img.shields.io/badge/SQS-FF4F8B?logo=amazonsqs&logoColor=white">
  <img alt="Amazon Cognito" src="https://img.shields.io/badge/Cognito_PKCE-DD344C?logo=amazoncognito&logoColor=white">
</p>

<p>
  <img alt="Google Gemini" src="https://img.shields.io/badge/Google_Gemini_2.5_Flash-8E75B2?logo=googlegemini&logoColor=white">
  <img alt="Terraform" src="https://img.shields.io/badge/Terraform-7B42BC?logo=terraform&logoColor=white">
  <img alt="GitHub Actions" src="https://img.shields.io/badge/GitHub_Actions-2088FF?logo=githubactions&logoColor=white">
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white">
</p>

</div>

Upload a statement, get back KPI cards, category breakdowns, top merchants, and a natural-language overview of where the money went — across one month or rolled up by quarter or year.

## Features

- **Deterministic PDF parsers** for **TPBank and VIB** Vietnamese credit card statements — no LLM in the parse path, just regex / coordinate geometry + Zod validation. The issuing bank is **auto-detected** from the statement text, so you just drop the file in. Handles **password-protected PDFs** by trying each configured password.
- **Asynchronous upload pipeline** — the browser hashes the PDF, uploads straight to S3 through a checksum-pinned presigned URL, and polls a job record while a queue-driven worker parses it. Nothing large passes through the API.
- **Rule-based categorization** with merchant name normalization (strips locale suffixes, maps known variants to canonical names).
- **Dashboard**: KPI cards, category donut, top-merchants bar coloured by category, spending trend, installment area chart, and a transactions table with category filtering.
- **AI summary** streamed from Google Gemini (2.5 Flash) using **anonymized aggregates only** — no card numbers, no individual transactions, no PII leaves the backend.
- **Multi-period views**: switch between month / quarter / year; the period lives in the URL so views are shareable and survive refresh.
- **Bank filter**: narrow the dashboard to one bank or view them combined; like the period, the selection lives in the URL.
- **Cognito authentication** using Authorization Code + PKCE — no client secret exists in browser code — gated to a single allowlisted email.
- **Dark mode** toggle (system / light / dark) and a **mobile-first** layout designed to work at 390px and up.
- **Offline dev stack** — run the real Lambda handlers against file-backed fake S3 and DynamoDB with no AWS account and no sign-in.

## Architecture

Cashight is a **static SPA plus serverless microservices**. The Next.js app is a static export (`output: 'export'`) served from S3 via CloudFront — there is no Next.js server process. All authenticated logic runs in purpose-built Lambda functions behind a Regional REST API, and pure domain logic lives in `packages/domain/`, shared by both the browser bundle and the Lambda handlers.

```
PDF upload (browser SPA)
  → SHA-256 digest (crypto.subtle)
  → POST /uploads                        [API Gateway + Cognito authorizer]
  → uploads-api          → DynamoDB PENDING_UPLOAD job + presigned S3 URL
  → PUT PDF to presigned URL             (checksum-pinned, 5-min expiry)
  → S3 notification → SQS cashight-parse → parser-worker
      → validate magic bytes
      → parseTPBankStatement()           (pdf-parse → regex → PAN masked here)
      → categorize() + normalizeMerchant()
      → StatementSchema.parse()          (Zod boundary)
      → S3 PutObject   users/{sub}/statements/{last4}/{year}/{year}-{mm}.json
      → DynamoDB PROCESSING → SUCCEEDED  (conditional write)
  → browser polls GET /uploads/{jobId} until terminal state

Dashboard
  → GET /dashboard?period=month&year=2026&month=5
  → dashboard-api
      → DynamoDB query for statement metadata
      → S3 parallel GetObject + Zod validate
      → aggregate(statements, periodSpec) (pure rollup)
  → AggregatedView JSON → charts, cards, table

AI summary
  → GET /summaries?period=...
  → summary-api (streamifyResponse)
      → buildSummaryPayload()            (strip to anonymized aggregates)
      → Gemini 2.5 Flash streaming
  → ReadableStream chunks → browser
```

### Backend functions

| Lambda | Responsibility |
| --- | --- |
| `auth-guard` | API Gateway authorizer — validates the Cognito token and the email allowlist |
| `uploads-api` | Creates the job record and issues the presigned upload URL |
| `upload-status-api` | Serves job state for browser polling |
| `parser-worker` | SQS consumer: parse → categorize → validate → persist |
| `statements-api` | List and delete persisted statements |
| `dashboard-api` | Period aggregation for the dashboard |
| `summary-api` | Streams the Gemini summary |

### Design rules

- **S3 is the source of truth** for transactions. DynamoDB indexes metadata only — it never stores raw transaction arrays.
- **The PAN is masked to `cardLast4` at the parser boundary.** The full number is never logged, stored, or transmitted.
- **Zod validates every boundary**: parser output, S3 reads, SQS events, API JSON, and Gemini input.
- **Aggregation functions are pure** — no I/O, new objects only.
- **Region is `ap-southeast-1`** (Singapore) everywhere, for proximity to HCMC.

**Stack**: Next.js 16 (App Router, static export) · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Recharts · Zod · `pdf-parse` · `@google/genai` · `oidc-client-ts` · AWS Lambda (Node 22) · API Gateway · S3 · DynamoDB · SQS · CloudFront · Cognito · WAF · Secrets Manager · Terraform · Vitest.

> [!TIP]
> Full architecture documentation lives in [`docs/codebase/`](./docs/codebase/) — stack, structure, conventions, integrations, testing, concerns, and Mermaid diagrams.

## Privacy

> [!IMPORTANT]
> The card PAN is masked to its last 4 digits **at the parser boundary** — the full number is never logged, stored, or transmitted. The Gemini summary endpoint receives only anonymized totals, top categories, and top merchants — never raw transaction descriptions.

## Getting started

### Prerequisites

- Node.js 20+ (CI runs Node 24; Lambdas run the `nodejs22.x` runtime)
- [pnpm](https://pnpm.io/) (pinned to `11.2.2` via `packageManager` in `package.json`)
- A [Google AI Studio](https://aistudio.google.com/) API key for Gemini
- An AWS account and Terraform 1.10+ — for the full stack only, not for local work

### Local development without AWS

The fastest path. No AWS account, no Cognito sign-in, no Docker:

```bash
pnpm install
pnpm dev:local   # real Lambda handlers over file-backed fake S3 + DynamoDB
pnpm dev         # in a second terminal
```

Visit http://localhost:3000 and drop a TPBank statement PDF on the upload page. See [`docs/local-development.md`](./docs/local-development.md) for what the stack deliberately does *not* cover (token validation, presigned-URL signing, IAM, SQS retry).

### Common commands

| Task                                | Command                              |
| ----------------------------------- | ------------------------------------ |
| Dev server                          | `pnpm dev`                           |
| Local API stack (no AWS/Cognito)    | `pnpm dev:local`                     |
| Wipe local stack data               | `pnpm dev:local:reset`               |
| Static export build                 | `pnpm build`                         |
| Verify the static export            | `pnpm verify:static`                 |
| Build Lambda bundles                | `pnpm build:lambdas`                 |
| Type check                          | `pnpm tsc --noEmit`                  |
| Lint                                | `pnpm lint`                          |
| Unit tests (Vitest)                 | `pnpm test`                          |
| Run the parser against a local PDF  | `pnpm tsx scripts/test-parser.ts`    |
| Provision AWS infra                 | `cd terraform && terraform apply`    |

### Environment variables

See [`.env.example`](./.env.example) for the full annotated list.

The `NEXT_PUBLIC_*` values are **baked into the static export at build time**, so they must be set in the build environment — not at runtime:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | API base URL (`terraform output api_gateway_url`) |
| `NEXT_PUBLIC_COGNITO_AUTHORITY` | Cognito OIDC issuer (`terraform output cognito_issuer`) |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Public SPA client ID — no secret (`terraform output cognito_spa_client_id`) |
| `NEXT_PUBLIC_APP_ORIGIN` | App origin, used for PKCE redirect URI validation |
| `NEXT_PUBLIC_DEV_AUTH_BYPASS` | Skips Cognito sign-in for `pnpm dev:local`. Inert in production builds |

Backend values are read by the Lambdas at runtime. In production the secrets live in **AWS Secrets Manager** (`/cashight/prod/gemini-api-key`, `/cashight/prod/pdf-password`) and the rest come from Terraform outputs:

| Variable | Purpose |
| --- | --- |
| `STATEMENTS_BUCKET` | S3 bucket for parsed statement JSON |
| `STORAGE_REGION` / `AWS_REGION` | `ap-southeast-1` |
| `ALLOWED_EMAIL` | The single account permitted to sign in |
| `GEMINI_API_KEY` | Google AI Studio key for the summary endpoint |
| `PDF_PASSWORD` | Unlocks password-protected statement PDFs (optional). May instead be a JSON map of per-bank candidates, `{"TPB":"…","VIB":"…"}` — keys are labels, every value is tried |

## Deployment

**Merging a PR into `main` deploys to production automatically.**

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yaml` | Pull request to `main` | Audit, typecheck, lint, test, package Lambda + frontend artifacts |
| `application-deploy.yaml` | PR merged into `main`, or manual | Lambda canary release → frontend → smoke tests → release manifest |
| `infrastructure-deploy.yaml` | Manual (`workflow_dispatch`) | Terraform plan / apply |
| `tf-ci.yaml` | Pull request touching `terraform/**` | Format, validate, lint |

Backend rolls out through CodeDeploy canaries on each function's `live` alias; the frontend is rebuilt with production Cognito values and pushed to S3 + CloudFront, then smoke-tested, then a release manifest records the checksums.

Nothing is rebuilt at deploy time. CI runs on `pull_request`, so a green run already holds the exact Lambda zips that were validated; a `resolve` job finds that run and every stage below pins to it. This means **production runs the PR branch tip that CI tested, not the squash/merge commit on `main`** — the two are content-identical, and the merge commit has no artifacts of its own.

To deploy without merging — or to roll back, or retry a failed canary — dispatch **Application Deploy** manually with the `ci_run_id` of any green CI run. Both entry points share a `production-deploy` concurrency group, so an automatic and a manual deploy can never shift the same Lambda aliases at once.

See [`docs/DEPLOYMENT_SERVERLESS.md`](./docs/DEPLOYMENT_SERVERLESS.md) for the full runbook, including rollback.

## Project structure

```
.
├── app/                    # Next.js App Router — static page shells (client components)
│   ├── components/         # Dashboard, charts, upload, nav
│   ├── upload/             # Upload page
│   ├── statements/         # Statement list
│   └── signin/, auth/      # Cognito PKCE sign-in and callback
├── components/ui/          # shadcn/ui primitives
├── frontend/
│   ├── api/                # Typed fetch client, 401 handling, summary streaming
│   ├── auth/               # Cognito PKCE session, token storage, route guard
│   └── hooks/              # use-dashboard, use-statements, use-upload-job
├── backend/
│   ├── functions/          # One directory per Lambda handler
│   └── shared/             # Auth claims, DynamoDB records, S3 keys, secrets, responses
├── packages/domain/src/    # Pure domain logic shared by browser and Lambdas
│   ├── parsers/            # TPBank PDF parser (masks the PAN)
│   ├── schemas.ts          # Zod data model
│   ├── categorize.ts       # Merchant → category rules
│   ├── aggregations.ts     # Pure month/quarter/year rollups
│   └── summary-payload.ts  # Anonymizer for the AI summary
├── terraform/              # Lambda, API Gateway, S3, DynamoDB, SQS, CloudFront,
│                           #   Cognito, WAF, IAM, CodeDeploy, monitoring
├── scripts/
│   └── local/              # Offline dev stack (fake S3 + DynamoDB)
└── docs/                   # codebase/, plans/, runbooks/, deployment guides
```

## Implementation plan

Cashight was built incrementally from a numbered plan. The steps live in [`docs/plans/`](./docs/plans/) — start at [`docs/plans/00-INDEX.md`](./docs/plans/00-INDEX.md) for the dependency graph. The plan spans the original 11-step MVP through later additions, ending with the [hybrid serverless migration](./docs/plans/29-hybrid-serverless-migration.md) that replaced Amplify SSR with the current architecture.
