# Architecture

> **Post-Phase 9 update (2026-06-29)**: The application migrated from Amplify SSR
> to a static Next.js SPA on CloudFront/S3 with a Lambda + API Gateway backend.
> The Amplify app remains in standby until Phase 10 decommission.

## Core Sections (Required)

### 1) Architectural Style

- Primary style: **Static SPA + serverless microservices on AWS** — a Next.js static export (no server runtime) is served from S3 via CloudFront. All authenticated backend logic runs in purpose-built Lambda functions behind a Regional REST API. Domain logic is extracted into `packages/domain/` and is reused by both the browser bundle and Lambda handlers.
- Why this classification: the browser downloads a single static HTML/JS/CSS export; there is no Next.js server process. Backend capabilities are split by bounded responsibility (`uploads-api`, `parser-worker`, `statements-api`, `dashboard-api`, `summary-api`, `auth-guard`). Each Lambda is thin — it delegates to shared adapters in `backend/shared/` and pure domain modules in `packages/domain/`.
- Primary constraints (baked into `CLAUDE.md` and `docs/plans/29-hybrid-serverless-migration.md`):
  1. **PCI hygiene** — PAN masked to `cardLast4` at the parser boundary (`packages/domain/src/parsers/tpbank.ts`); never logged/stored/sent/prompted.
  2. **AI gets aggregates only** — `summary-api` calls `buildSummaryPayload()` before the Gemini prompt (`packages/domain/src/summary-payload.ts`); no raw transaction descriptions or PII enter the AI payload.
  3. **S3 is the transaction source of truth** — statement JSON in `users/{sub}/statements/{cardLast4}/{year}/{year}-{mm}.json`. DynamoDB indexes metadata only; it never stores raw transaction arrays (REQ-010).
  4. **Zod at every boundary** — parser output, S3 reads, SQS events, API JSON, and Gemini input are all validated with Zod before being trusted.
  5. **PKCE, no client secret** — browser auth uses Cognito Authorization Code + PKCE (`oidc-client-ts`); no client secret exists in browser code.

### 2) System Flow

```text
PDF upload (browser SPA)
  → SHA-256 digest (crypto.subtle)
  → POST /uploads {fileName, sha256, size, contentType}          [API Gateway + Cognito authorizer]
  → uploads-api Lambda → DynamoDB PENDING_UPLOAD job
  → PUT PDF to presigned S3 URL (exact checksum, 5-min expiry)
  → S3 notification → SQS parse-queue → parser-worker Lambda
      → download PDF, validate magic bytes
      → parseTPBankStatement()  [pdf-parse → regex → mask PAN]
      → categorize() + normalizeMerchant()
      → StatementSchema.parse()  [Zod boundary]
      → S3 PutObject  [users/{sub}/statements/{last4}/{yr}/{yr}-{mm}.json]
      → DynamoDB PROCESSING → SUCCEEDED (conditional expression)
      → delete upload PDF
  → browser polls GET /uploads/{jobId} until SUCCEEDED/FAILED/CONFLICT

Dashboard (browser SPA client component)
  → GET /dashboard?period=month&year=2026&month=5              [API Gateway]
  → dashboard-api Lambda
      → DynamoDB query USER#{sub} STATEMENT# metadata
      → S3 parallel GetObject (concurrency 5) + Zod validate
      → aggregate(statements, periodSpec)                       [pure rollup]
  → JSON AggregatedView → render charts/cards/table

AI summary (browser SPA)
  → GET /summaries?period=...                                   [API Gateway streaming]
  → summary-api Lambda (awslambda.streamifyResponse)
      → DynamoDB + S3 fetch for period
      → buildSummaryPayload()                                   [strip to anonymized aggregates]
      → Gemini 2.5 Flash streaming prompt
  → ReadableStream chunks → browser
```

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| Lambda handlers (`backend/functions/*/handler.ts`) | HTTP↔domain translation, auth claims, error mapping | Domain math, AWS SDK initialization | `backend/functions/uploads-api/handler.ts` |
| Shared adapters (`backend/shared/`) | Claim extraction, DynamoDB records, S3 keys, secrets, standard responses, observability | Business logic, HTTP routing | `backend/shared/auth-claims.ts`, `storage.ts` |
| Domain package (`packages/domain/src/`) | Parsing, categorization, aggregation, period, formatting, privacy payload, Zod schemas | AWS SDK, browser/Lambda runtime deps | `packages/domain/src/parsers/tpbank.ts` |
| Browser auth (`frontend/auth/`) | Cognito PKCE session, token storage, API bearer attachment, logout | Business data access | `frontend/auth/oidc.ts`, `auth-provider.tsx` |
| API client (`frontend/api/`) | Typed fetch wrappers, 401 handling, ReadableStream for summaries | Auth implementation, DOM rendering | `frontend/api/client.ts` |
| UI (`app/components/`, `components/ui/`) | Rendering charts/tables/cards | Direct AWS calls, auth logic | `app/components/dashboard.tsx` |
| Static app routes (`app/`) | Next.js page shells (client components) | Server-only imports, `requireSession` | `app/page.tsx`, `app/upload/page.tsx` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| PKCE + sessionStorage | `frontend/auth/oidc.ts` | No client secret in browser; tokens isolated to tab session |
| Boundary validation (Zod) | Every Lambda entry point, every S3 read, every SQS event | Trust types only after parse; catch schema drift at the boundary |
| Conditional DynamoDB writes | `parser-worker/handler.ts` | Idempotent job transitions; duplicate SQS delivery is harmless |
| Partial batch failure response | `parser-worker/handler.ts` | Retryable infra failures retry; business failures (bad PDF, conflict) are terminal |
| Bearer token scoping | `frontend/api/client.ts` | `Authorization` header only to `NEXT_PUBLIC_API_BASE_URL` origin; never to third parties |
| Dedicated IAM role per Lambda | `terraform/iam.tf` | Least-privilege; blast radius of a compromised function is bounded to its resource set |
| Presigned PUT with exact checksum | `uploads-api/handler.ts` | PDF bytes never pass through API Gateway; S3 enforces the exact checksum |
| buildSummaryPayload privacy gate | `packages/domain/src/summary-payload.ts` | Mandatory anonymization before Gemini; raw txns and PAN cannot reach the AI API |

### 5) Known Architectural Risks

- **DynamoDB metadata fan-out** — `dashboard-api` queries metadata then does a bounded parallel S3 GET (concurrency 5). At personal scale this is fast; it would need DynamoDB GSI or caching at >100 statements per period.
- **Async upload UX** — the upload flow is polling-based (1→2→4→5s intervals, 2-min client timeout). A slow PDF parse can approach the client timeout. The parser Lambda has a 120-s timeout and reserved concurrency of 2.
- **Cognito sub stability** — federated Google users receive a Cognito-assigned `sub` distinct from their Google subject. Data migration and `AUTHZ#{sub}/PROFILE` records are keyed on this stable Cognito sub.
- **S3 sequential source of truth** — S3 PutObject + DynamoDB conditional write are not atomic. A parser Lambda crash between the two leaves a valid S3 object without a metadata record. Deterministic keys + reconciliation repair this state without data loss.
- **Static SPA XSS surface** — access tokens in `sessionStorage` are exposed to successful XSS. CSP, WAF, short token lifetimes (1 h), session-only storage, and no untrusted HTML rendering reduce but do not eliminate the risk (RISK-008).

### 6) Evidence

- `packages/domain/src/` — portable domain logic
- `backend/functions/` — Lambda handlers
- `backend/shared/` — shared adapters
- `frontend/auth/`, `frontend/api/` — browser auth and API client
- `app/` — Next.js static page shells
- `terraform/` — all AWS infrastructure as code
- `CLAUDE.md` — architectural conventions
- `docs/plans/29-hybrid-serverless-migration.md` — migration contract and requirements
- `docs/runbooks/hybrid-serverless-migration.md` — cutover and rollback runbook
