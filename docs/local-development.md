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
| Cognito JWT authorizer | fixed claims for `DEV_AUTH_SUB` (default `local-dev-user`) |
| S3 (uploads + statements) | `.local-data/objects/<bucket>/<key>` — real files on disk |
| DynamoDB single table | `.local-data/table.json` |
| S3 → SQS → parser Lambda | a background call to `createProcessJob(...)` after the PUT |
| Secrets Manager | `PDF_PASSWORD` / `GEMINI_API_KEY` from `.env.local` |

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

# Optional — only if your statement PDFs are password protected
PDF_PASSWORD=...
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

The bypass means the local stack tells you nothing about the parts of the
system that are about identity and IAM:

- **Token validation and scopes.** Claims are synthesized, so a token that
  would be rejected in production sails through. Covered by
  `backend/__tests__/auth-guard.test.ts`.
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
