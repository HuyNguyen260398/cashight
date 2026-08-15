# Local development stack

`pnpm dev:local` runs a local API server that lets you upload a PDF statement,
watch it get parsed, and browse the resulting dashboard — with **no AWS
account, no Cognito sign-in, and no Docker**.

## What it is

The server (`scripts/dev-server.ts`) imports the *production* Lambda handler
factories and hands them file-backed dependencies. The handler code is
unmodified; only what sits underneath it changes.

| Production | Local |
| --- | --- |
| API Gateway | route table in `scripts/dev-server.ts` (same paths as `terraform/api-openapi.yaml.tftpl`) |
| Cognito JWT authorizer | fixed claims for `DEV_AUTH_SUB` (default `local-dev-user`) — or real token verification, see [Real Cognito sign-in](#real-cognito-sign-in) |
| S3 (uploads + statements) | `.local-data/objects/<bucket>/<key>` — real files on disk |
| DynamoDB single table | `.local-data/table.json` |
| S3 → SQS → parser Lambda | a background call to `createProcessJob(...)` after the PUT |
| Secrets Manager | `PDF_PASSWORDS` (JSON map, falling back to `PDF_PASSWORD`) / `GEMINI_API_KEY` from `.env.local` |
| Cost Explorer API | fixed synthetic figures — or your real account, see [Real Cost Explorer data](#real-cost-explorer-data) |

Because the metadata layer talks to a fake `DynamoDBDocumentClient`
(`scripts/local/dynamo.ts`) rather than a reimplementation, the conditional
writes that give the upload pipeline its idempotency and state-machine
guarantees run for real locally: `transitionJobState`'s
`attribute_exists(PK) AND #state = :from`, and `putIdempotencyRecord`'s
`attribute_not_exists(PK)`.

**Nothing in `scripts/local/` is imported by the app or bundled into a Lambda.**

## Setup

In `.env.local`:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
NEXT_PUBLIC_DEV_AUTH_BYPASS=true

# Optional — only if your statement PDFs are password protected.
# One password:
PDF_PASSWORD=
# Or one per bank — keys are labels, every value is tried in turn (the bank
# can only be detected after the PDF is decrypted). Wins over PDF_PASSWORD:
PDF_PASSWORDS={"TPB":"...","VIB":"..."}...
# Optional — without it, /summaries returns a canned stub instead of calling Gemini
GEMINI_API_KEY=...
```

`NEXT_PUBLIC_COGNITO_*` and `NEXT_PUBLIC_APP_ORIGIN` are not required while the
bypass is on.

Then, in two terminals:

```bash
pnpm dev:local   # API on http://localhost:8787
pnpm dev         # app on http://localhost:3000
```

Open <http://localhost:3000/upload> and drop in a PDF. It goes through the
same four steps as production: hash → `POST /uploads` → PUT the bytes → poll
`GET /uploads/{jobId}` until terminal.

## Real Cognito sign-in

The bypass is one switch shared by both processes: the SPA sends an
`Authorization` header exactly when the dev server demands one, so they cannot
drift apart. Turn it off in `.env.local` to exercise the real auth path:

```dotenv
NEXT_PUBLIC_DEV_AUTH_BYPASS=false
NEXT_PUBLIC_COGNITO_AUTHORITY=https://cognito-idp.ap-southeast-1.amazonaws.com/<user-pool-id>
NEXT_PUBLIC_COGNITO_CLIENT_ID=<terraform output cognito_spa_client_id>
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
```

Restart both processes. `pnpm dev` sends you through Cognito's hosted UI, and
`pnpm dev:local` verifies the resulting access token against the pool's JWKS
(`scripts/local/cognito-auth.ts`) before any handler runs — real signature,
issuer, audience, expiry and `token_use` checks, and the handlers see the real
`sub` and `scope` claims. A missing or invalid token gets a 401 from the router
instead of reaching a handler.

No AWS change is needed: the user pool already lists
`http://localhost:3000/auth/callback/` in its callback URLs
(`terraform/cognito.tf`).

Because there is no Cognito trigger locally, the dev server stands in for
`auth-guard/handler.ts` and writes the `AUTHZ` record for whichever `sub` signs
in — production keeps a real allowlist, but locally a 403 on every route is a
confusing way to learn that.

**The identity provider on that record is derived, never assumed.** It gates AWS
Cost Explorer: `session-capabilities-api` and `cost-explorer-api` both require
`authProvider === 'COGNITO'`, so a Google sign-in gets `canViewAwsCosts: false`
and a `403 COGNITO_REAUTH_REQUIRED` on cost queries, exactly as in production.
The trigger reads the `identities` user attribute, which is not in an access
token, so locally it comes from the `username` claim — `Google_<sub>` means
Google, a bare username means a native pool user — using the same rule as the
legacy authorization path (`providerFromSignedUsername`). An unrecognised
username fails closed with a 401 rather than defaulting to the privileged
provider. The boot log names the provider on each first sign-in.

Everything else stays available to a Google session: statements, invoices and
the bank dashboards are workspace-scoped, not provider-scoped.

One more local-only difference: the presigned-PUT endpoint stays
unauthenticated, because a real S3 presigned URL carries its authorization in
the signature rather than a bearer token.

Access tokens last an hour; `AuthProvider` renews silently before expiry, so in
practice this is one sign-in per browser session.

## Real Cost Explorer data

By default `/aws/cost-explorer/*` returns fixed synthetic figures, so the stack
keeps working with no AWS account. To read your own account instead:

```dotenv
LOCAL_AWS_COST_EXPLORER=real
```

The dev server then constructs the same `CostExplorerAwsAdapter` the Lambda
uses, against your ambient AWS credentials (`~/.aws`, `AWS_PROFILE`, or an SSO
session). Only the data source changes — the result cache, saved reports and
CSV exports all stay local, and nothing is written to AWS.

The credentials need `ce:Get*` / `ce:List*` and `billing:ListBillingViews`;
the Cost Explorer API is **billable at roughly $0.01 per request**, which is
why this is opt-in. The boot banner always states which source is live, so the
numbers on screen are never ambiguous.

Resource-level granularity stays off (`granularDataEnabled: false`) — it needs
a separate account-level opt-in.

## Inspecting and resetting

Everything lives under `.local-data/` (gitignored — it holds real statement
data):

```
.local-data/
├── table.json                       # every DynamoDB item, pretty-printed
└── objects/
    ├── uploads/                     # PDFs mid-flight; deleted once parsed
    └── statements/users/local-dev-user/statements/9674/2026/2026-05.json
```

`table.json` is the fastest way to debug a stuck upload — find the
`JOB#<id>` item and read its `state` and `errorCode`.

```bash
pnpm dev:local:reset   # wipe .local-data/ and start clean
```

## What it does not cover

With the bypass on, the local stack tells you nothing about the parts of the
system that are about identity and IAM:

- **Token validation and scopes.** Claims are synthesized, so a token that
  would be rejected in production sails through. Covered by
  `backend/__tests__/auth-guard.test.ts` — or turn the bypass off, see
  [Real Cognito sign-in](#real-cognito-sign-in).
- **Presigned URL correctness.** The "presigned" URL is just the dev server's
  own `PUT /_local/objects/...` endpoint — no signature, no expiry, and no
  `ChecksumSHA256` enforcement by the storage layer. (The parser worker still
  verifies the SHA-256 itself, so checksum mismatches *are* exercised.)
- **IAM policies, bucket policies, CORS on the real API.**
- **SQS retry / DLQ behaviour.** A parser error is logged once and not retried.

For those, use the deployed environment — `pnpm dev:api-proxy` points the local
SPA at the real API.

## Switching back to the deployed API

Set `NEXT_PUBLIC_DEV_AUTH_BYPASS=false` (or remove it), restore the
`NEXT_PUBLIC_COGNITO_*` values, and point `NEXT_PUBLIC_API_BASE_URL` at either
the real API or `pnpm dev:api-proxy`. Restart `pnpm dev` — `NEXT_PUBLIC_*`
values are read at build time, not per request.
