# Local Development Against the Hybrid Serverless Backend

Since the [hybrid serverless migration](./DEPLOYMENT_SERVERLESS.md), `pnpm dev` only serves the Next.js static SPA — there is no local API. `next.config.ts` sets `output: 'export'`; all `app/api/*` routes are gone, replaced by Lambda functions in `backend/functions/` behind API Gateway. There is also only one deployed API stage (`prod`) — no separate dev/staging backend.

This means local dev is: **local frontend (`localhost:3000`) + real production backend and Cognito user pool.** Two things about that setup don't work out of the box, and both are fixed by local-only configuration — nothing on AWS needs to change.

---

## 1. OIDC sign-in redirects to production

### Symptom
After signing in, the browser lands on `https://cashight.nghuy.link/` instead of `http://localhost:3000/`.

### Cause
`frontend/auth/oidc.ts` builds the Cognito `redirect_uri` from `NEXT_PUBLIC_APP_ORIGIN`. In `.env.example` (and, until fixed, `.env.local`) that value points at prod.

### Fix
In `.env.local`:

```
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
```

`frontend/auth/config.ts` exempts `http://localhost` / `http://127.0.0.1` from the HTTPS check it otherwise enforces on all `NEXT_PUBLIC_*` origins, so this value is accepted outside of test mode. The Cognito app client's callback/logout URL allowlist already includes the localhost URLs (`terraform/cognito.tf`), so no Terraform change is needed.

> After changing any `NEXT_PUBLIC_*` variable, restart `pnpm dev` — Next.js inlines these at build/start time, not per-request.

---

## 2. CORS error calling the API from localhost

### Symptom
```
Access to fetch at 'https://api.cashight.nghuy.link/statements' from origin 'http://localhost:3000'
has been blocked by CORS policy: ... 'Access-Control-Allow-Origin' header has a value
'https://cashight.nghuy.link' that is not equal to the supplied origin.
```

### Cause
The prod API enforces **SEC-006**: every response (Lambda proxy responses in `backend/shared/api-response.ts`, and API Gateway's preflight/gateway-error responses in `terraform/api-openapi.yaml.tftpl`) hardcodes `Access-Control-Allow-Origin: https://cashight.nghuy.link`. This is a deliberate security control, not an oversight — it is intentionally locked to exactly one origin.

Loosening it to also allow `localhost` would mean editing both of those files and running `terraform apply` + redeploying all Lambdas to **production** just to support local testing. Instead:

### Fix: local CORS proxy
`scripts/dev-api-proxy.mjs` is a zero-dependency Node proxy that sits between the local browser and the real prod API. It forwards every request unchanged and rewrites only the `Access-Control-Allow-Origin` response header to match the local browser origin. No AWS resource is touched.

Run it alongside the dev server (two terminals):

```bash
pnpm dev:api-proxy   # listens on :8787, forwards to https://api.cashight.nghuy.link
pnpm dev             # Next.js dev server on :3000
```

In `.env.local`, point the SPA at the proxy instead of the API directly:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
```

Config knobs (env vars, all optional):

| Variable | Default | Purpose |
|---|---|---|
| `API_PROXY_TARGET` | `https://api.cashight.nghuy.link` | Upstream API to forward to |
| `API_PROXY_PORT` | `8787` | Local port the proxy listens on |
| `API_PROXY_ALLOWED_ORIGIN` | `http://localhost:3000` | Only browser origin the proxy will serve; anything else gets `403` |

The `Authorization: Bearer <token>` header (attached client-side by `frontend/api/client.ts`) passes through untouched, so requests are authenticated exactly as they would be against the real API.

---

## Quick start

```bash
cp .env.example .env.local   # if you haven't already
# then set, at minimum:
#   NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
#   NEXT_PUBLIC_API_BASE_URL=http://localhost:8787

pnpm dev:api-proxy   # terminal 1
pnpm dev             # terminal 2
```

Open `http://localhost:3000`, sign in, and verify requests to `/statements`, `/dashboard`, etc. succeed in the Network tab with `access-control-allow-origin: http://localhost:3000`.
