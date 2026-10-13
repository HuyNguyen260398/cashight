# EKS Migration, Plan 1 of 5: Backend Container Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Lambda handlers runnable as one container image with four entrypoints (two HTTP APIs, two SQS workers), without changing how the Lambdas run today.

**Architecture:** A thin Node HTTP server and an SQS polling loop wrap the unchanged `handler(event)` functions. The server rebuilds the API Gateway proxy event (verified Cognito claims included), so authorization code is untouched. Telemetry is manual OpenTelemetry instrumentation with an allowlist of attributes; it is a no-op unless an OTLP endpoint is configured, so the same code still builds and runs as Lambdas. All of it lands on the `cashight-v2` branch; `main` and the deployed Lambdas are not touched.

**Tech Stack:** Node 22, TypeScript, esbuild, vitest, `aws-jwt-verify`, `@aws-sdk/client-sqs`, OpenTelemetry JS (API + trace/metrics SDK + OTLP/HTTP exporters), Docker (distroless Node 22, arm64).

**Spec:** `docs/superpowers/specs/2026-10-08-eks-migration-design.md` (§1 rollout decision, §4.2, §4.3, §4.6 privacy rules, §5 phases)

## Rollout model (revised 2026-10-13)

The first draft of the spec shifted `api.cashight.nghuy.link` between API Gateway and the ALB with weighted DNS. That is replaced by a parallel rollout on a second hostname:

1. **The current architecture stays exactly as it is** at `cashight.nghuy.link` and `api.cashight.nghuy.link`. Plans 1–4 do not touch its DNS records, API Gateway, Lambdas or CodeDeploy setup.
2. **The new architecture comes up beside it** at `cashight-v2.nghuy.link` (SPA) and `api.cashight-v2.nghuy.link` (ALB → EKS). Both stacks share the Cognito user pool, DynamoDB table and S3 buckets, so the same statements are visible on both hostnames and there is no data migration.
3. **Soak on the v2 hostname** until it has run smoothly.
4. **Retire the old architecture** (API Gateway, the 11 migrated Lambdas, CodeDeploy), then **move the production names onto the new stack**: `cashight.nghuy.link` and `api.cashight.nghuy.link` point at it, and the v2 names are removed.

What that means for this plan:

| Requirement from the rollout | Where it lands |
|---|---|
| The API must answer CORS for whichever hostname its deployment serves, and the two stacks serve different ones at the same time | The allowed origin becomes per-deployment configuration: `ALLOWED_ORIGIN`, defaulting to `https://cashight.nghuy.link` (Task 5, Steps 1–3) |
| The final rename must not need a new image | The hostname appears in no code path other than that default. Renaming is a manifest change: set `ALLOWED_ORIGIN` back, or remove it |
| The old stack is the fallback until step 4 | Work happens on `cashight-v2`, which deploys nothing (see Branching). The two shared-module edits listed under Global Constraints also keep today's behaviour when `ALLOWED_ORIGIN` is unset, so the Lambdas stay buildable and correct from this branch |

### Branching

All work on the new architecture lives on the long-lived branch **`cashight-v2`**, cut from `main`. `main` stays the branch the current architecture deploys from.

- Every feature branch for the new architecture is created from `cashight-v2` and its pull request targets `cashight-v2`, never `main`. This plan's branch is `feat/container-runtime`.
- `application-deploy.yaml` runs only when a pull request into `main` closes. Merging into `cashight-v2` therefore deploys nothing: the Lambdas keep running the code on `main`, and the shared-module edits in this plan do not reach them.
- `ci.yaml` runs only for pull requests into `main` today. Task 9 adds `cashight-v2` to its trigger so this plan's pull request is checked. `tf-ci.yaml` has the same filter; Plan 4 extends it when it first touches `terraform/`.
- Fixes to the current architecture still go to `main`. Merge `main` into `cashight-v2` after each one (`git switch cashight-v2 && git merge main`) so the two do not drift; never merge the other way before the rename.
- `cashight-v2` merges into `main` once, in Plan 5, as part of retiring the old architecture and renaming. Until then the branch is the unit of rollback: `main` is unaffected by anything on it.

Not in this plan: the v2 DNS records and certificates, Cognito callback URLs for the v2 origin, S3 bucket CORS for the v2 origin (`terraform/data.tf` lists allowed origins for presigned uploads), the v2 SPA build, and which stack consumes the shared SQS queues. Those belong to Plans 4 and 5.

## Where this plan sits

The spec covers five independent subsystems across two repositories. Each gets its own plan and produces something testable on its own.

| Plan | Repo | Delivers | Spec phases | Depends on |
|---|---|---|---|---|
| **1. Backend container runtime (this plan)** | `cashight` | Image with four entrypoints, tested locally and in CI | 3 | — |
| 2. Platform capacity and add-ons | `aws-eks-infra` | EC2 node group, EBS CSI, Pod Identity, KEDA, `cashight` namespace, repo access | 0, 1 | — |
| 3. Observability stack | `aws-eks-infra` | Mimir, Loki, Tempo, Grafana, OTel Collectors, dashboards, alerts | 2 | 2 |
| 4. Cashight v2 stack: AWS resources, GitOps and CI | `cashight` | ECR, Pod Identity roles, v2 DNS and certificates, Cognito and S3 CORS entries for the v2 origin, v2 SPA build, `deploy/` manifests, Argo CD Application, image pipeline | 4, 5 | 1, 2, 3 |
| 5. Soak, decommission and rename | `cashight` | Soak on the v2 hostname, queue consumer switch, removal of API Gateway and Lambdas, production names moved onto the new stack, v2 names retired | 6, 7 | 4 |

Plans 1 and 2 can run in parallel. Nothing in this plan creates AWS resources or changes production behaviour.

## Global Constraints

- **Lambdas keep working.** `pnpm build:lambdas` and every existing test must still pass after every task. No handler signature changes.
- **The current architecture is the fallback and stays untouched.** No Terraform, DNS, API Gateway or Lambda configuration change in this plan. Exactly two edits reach code the Lambdas run: the observability adapter (Task 4) and the allowed-origin lookup in `backend/shared/api-response.ts` (Task 5). Neither may change what a Lambda returns or logs today. They are not deployed by this plan (nothing merges to `main`), but `cashight-v2` must stay a branch the Lambdas could be deployed from.
- **PCI and privacy.** No PAN, transaction description, cardholder name, email or token in any log line, span attribute or metric label. Span and metric attributes are limited to: HTTP method, route name, status code, worker outcome, error code.
- **No request bodies or query strings in telemetry or logs.**
- **Node 22** in the image, matching the Lambda runtime `nodejs22.x`.
- **arm64 image** (the platform nodes are Graviton).
- **`pdf.worker.mjs` must sit next to `index.js`** for both worker entrypoints.
- **DOM polyfill ordering** is owned by the domain parser modules; entrypoints must import handlers, never `pdfjs-dist` or `pdf-parse` directly.
- **CORS allows exactly one origin per deployment** (SEC-006). The default is `https://cashight.nghuy.link`; the v2 stack sets `ALLOWED_ORIGIN=https://cashight-v2.nghuy.link`. No wildcard, no list, no echoing the request's `Origin` header. A value that is not a single https origin stops the process at startup.
- **No hostname in code except that default.** `cashight-v2.nghuy.link` may appear only in tests, docs and CI checks, so the final rename is configuration only.
- **`pnpm` 11.2.2**, pinned by `packageManager`.
- **Region `ap-southeast-1`.**
- Work on branch `feat/container-runtime`, created from `cashight-v2`. The pull request targets `cashight-v2`. Nothing in this plan is merged or pushed to `main`.

## Review Focus

1. **A request with a valid signature but the wrong token type or client** (an ID token, or an access token minted for another app client) must get 401, never reach a handler. Pinned in Task 2.
2. **A malformed percent-encoded path** (`/statements/%E0%A4%A`) must get 404, not a 500 or a crash. Pinned in Tasks 1 and 5.
3. **An oversized or never-ending request body** must get 413 and must not buffer unbounded memory. Pinned in Task 5.
4. **A job that hangs** must not hold a queue message forever: the worker exits so Kubernetes restarts it and SQS redelivers. Pinned in Task 6.
5. **SIGTERM during an in-flight job** (every deploy and every KEDA scale-down) must let the job finish and delete its message, not abandon it half-written. Pinned in Task 6.
6. **A mistyped `ALLOWED_ORIGIN`** (a trailing slash, `http://`, `*`, two origins separated by a comma) must stop the pod at startup. Serving with it would either break every browser call on the v2 hostname or widen CORS, and both look like a healthy pod. Pinned in Task 5 and checked against the real bundle in Tasks 7 and 9.

## Request validation parity (checked while writing this plan)

API Gateway's `request-validator: all` goes away with the gateway. Every rule it enforced already has an equal or stricter check inside a handler, so no task adds validation:

| Gateway rule (`terraform/api-openapi.yaml.tftpl`) | Handler check |
|---|---|
| `CostReportEnvelope`: `request` required, `refresh` boolean, no extra properties | `QueryBodySchema` (`.strict()`) in `cost-explorer-api/handler.ts` |
| `CostDimensionRequest`: `type` required | `DimensionsBodySchema` |
| `SavedCostReportInput`: `name` 1–80 chars, `reportId` UUID, no extra properties | `ReportBodySchema` (`.strict()`) |
| `reportId` path parameter is a UUID | `ReportIdSchema` |
| Invoice `jobId` path parameter is a UUID | `z.string().uuid()` in `aws-invoices-api/handler.ts` |
| `yearMonth` path and query parameter match `YYYY-MM` | `YearMonthSchema` |
| Required path parameters are present | Guaranteed by `matchRoute`, which only matches when the segment exists |

One visible difference remains: an invalid request now gets the application's `{"error":{"code":"INVALID_REQUEST",…}}` body instead of the gateway's `{"message":"Invalid request body"}`. Both are HTTP 400.

## File Structure

| File | Responsibility |
|---|---|
| `backend/server/routes.ts` (new) | Pure route table: method + path → handler name, path parameters, whether a body is read |
| `backend/server/jwt.ts` (new) | Cognito access-token verification → the claims object handlers already read |
| `backend/server/rate-limit.ts` (new) | Token-bucket limiter replacing the API Gateway stage throttle |
| `backend/server/telemetry.ts` (new) | Starts OTel trace and metric export when an OTLP endpoint is set |
| `backend/server/http-server.ts` (new) | HTTP server: probes, CORS, limiter, auth, body limit, event construction, telemetry |
| `backend/server/sqs-consumer.ts` (new) | Long-poll loop that feeds one message at a time to a worker handler |
| `backend/server/start-api.ts`, `start-worker.ts` (new) | Process glue: env config, signals, graceful shutdown |
| `backend/server/entrypoints/*.ts` (new) | Four files that bind handlers to a start function |
| `backend/shared/observability.ts` (modify) | Powertools replaced by a JSON logger and an OTel-backed `metrics.addMetric` |
| `backend/shared/api-response.ts` (modify) | Read the allowed origin from `ALLOWED_ORIGIN` (default: the production hostname) and export it |
| `scripts/build-servers.mjs` (new) | esbuild bundles to `dist/servers/<name>/index.js` |
| `scripts/dev-server.ts` (modify) | Use the shared route table |
| `Dockerfile`, `.dockerignore` (new) | Image build |
| `docs/container-runtime.md` (new) | Environment variable contract for Plan 4 |

---

### Task 1: Route table

**Files:**
- Create: `backend/server/routes.ts`
- Test: `backend/__tests__/server-routes.test.ts`

**Interfaces:**
- Produces:
  - `type HandlerName = 'uploads' | 'uploadStatus' | 'statements' | 'dashboard' | 'sessionCapabilities' | 'summaries' | 'costExplorer' | 'awsInvoices' | 'awsInvoiceSummaries'`
  - `interface RouteMatch { handler: HandlerName; pathParameters: Record<string, string>; readsBody: boolean }`
  - `function matchRoute(method: string, pathname: string): RouteMatch | undefined`

- [ ] **Step 1: Create the branch**

The feature branch comes from `cashight-v2`, not `main`. The pull request in Task 9 needs `cashight-v2` to exist on the remote, so push it first if it is not there yet.

```bash
git switch cashight-v2
git ls-remote --exit-code --heads origin cashight-v2 || git push -u origin cashight-v2
git pull --ff-only
git switch -c feat/container-runtime
```

Verify: `git merge-base --is-ancestor cashight-v2 HEAD && git branch --show-current`
Expected: `feat/container-runtime`.

- [ ] **Step 2: Write the failing test**

Create `backend/__tests__/server-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { matchRoute } from '../server/routes';

describe('matchRoute', () => {
  it.each([
    ['POST', '/uploads', 'uploads', {}, true],
    ['GET', '/uploads/job-1', 'uploadStatus', { jobId: 'job-1' }, false],
    ['GET', '/statements', 'statements', {}, false],
    ['GET', '/statements/9674-2026-05', 'statements', { statementId: '9674-2026-05' }, false],
    ['DELETE', '/statements/9674-2026-05', 'statements', { statementId: '9674-2026-05' }, false],
    ['GET', '/dashboard', 'dashboard', {}, false],
    ['GET', '/session/capabilities', 'sessionCapabilities', {}, false],
    ['POST', '/summaries', 'summaries', {}, true],
    ['POST', '/aws/cost-explorer/query', 'costExplorer', {}, true],
    ['GET', '/aws/cost-explorer/reports', 'costExplorer', {}, false],
    ['DELETE', '/aws/cost-explorer/reports/r-1', 'costExplorer', { reportId: 'r-1' }, false],
    ['POST', '/aws/invoices/summary', 'awsInvoiceSummaries', {}, true],
    ['POST', '/aws/invoices/uploads', 'awsInvoices', {}, true],
    ['GET', '/aws/invoices/uploads/job-2', 'awsInvoices', { jobId: 'job-2' }, false],
    ['GET', '/aws/invoices', 'awsInvoices', {}, false],
    ['GET', '/aws/invoices/dashboard', 'awsInvoices', {}, false],
    ['GET', '/aws/invoices/2026-07', 'awsInvoices', { yearMonth: '2026-07' }, false],
    ['DELETE', '/aws/invoices/2026-07', 'awsInvoices', { yearMonth: '2026-07' }, false],
  ])('%s %s → %s', (method, path, handler, pathParameters, readsBody) => {
    expect(matchRoute(method, path)).toEqual({ handler, pathParameters, readsBody });
  });

  it.each([
    ['GET', '/'],
    ['GET', '/uploads'],
    ['DELETE', '/statements'],
    ['PUT', '/statements/x'],
    ['GET', '/statements/a/b'],
    ['POST', '/dashboard'],
    ['GET', '/session'],
    ['GET', '/summaries'],
    ['GET', '/aws'],
    ['GET', '/aws/cost-explorer'],
    ['GET', '/unknown'],
  ])('%s %s has no route', (method, path) => {
    expect(matchRoute(method, path)).toBeUndefined();
  });

  it('decodes path parameters', () => {
    expect(matchRoute('GET', '/uploads/a%20b')?.pathParameters).toEqual({ jobId: 'a b' });
  });

  it('treats malformed percent-encoding as no route instead of throwing', () => {
    expect(matchRoute('GET', '/statements/%E0%A4%A')).toBeUndefined();
  });

  it('ignores a trailing slash', () => {
    expect(matchRoute('GET', '/dashboard/')?.handler).toBe('dashboard');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test backend/__tests__/server-routes.test.ts`
Expected: FAIL — cannot resolve `../server/routes`.

- [ ] **Step 4: Write the implementation**

Create `backend/server/routes.ts`:

```ts
/**
 * The API route table, shared by the container HTTP server and the local dev
 * server. It mirrors terraform/api-openapi.yaml.tftpl: API Gateway used to do
 * this dispatch. The cost-explorer and invoices handlers own their own
 * method/subpath validation, so their entries are deliberately broad.
 */
export type HandlerName =
  | 'uploads'
  | 'uploadStatus'
  | 'statements'
  | 'dashboard'
  | 'sessionCapabilities'
  | 'summaries'
  | 'costExplorer'
  | 'awsInvoices'
  | 'awsInvoiceSummaries';

export interface RouteMatch {
  handler: HandlerName;
  pathParameters: Record<string, string>;
  readsBody: boolean;
}

function decodeSegments(pathname: string): string[] | undefined {
  const segments: string[] = [];
  for (const part of pathname.split('/')) {
    if (!part) continue;
    try {
      segments.push(decodeURIComponent(part));
    } catch {
      return undefined;
    }
  }
  return segments;
}

function match(
  handler: HandlerName,
  pathParameters: Record<string, string> = {},
  readsBody = false,
): RouteMatch {
  return { handler, pathParameters, readsBody };
}

export function matchRoute(method: string, pathname: string): RouteMatch | undefined {
  const segments = decodeSegments(pathname);
  if (!segments) return undefined;
  const [first, second, third, fourth] = segments;
  const count = segments.length;

  if (first === 'uploads') {
    if (method === 'POST' && count === 1) return match('uploads', {}, true);
    if (method === 'GET' && count === 2) return match('uploadStatus', { jobId: second });
    return undefined;
  }

  if (first === 'statements') {
    if (method === 'GET' && count === 1) return match('statements');
    if ((method === 'GET' || method === 'DELETE') && count === 2) {
      return match('statements', { statementId: second });
    }
    return undefined;
  }

  if (first === 'dashboard') {
    return method === 'GET' && count === 1 ? match('dashboard') : undefined;
  }

  if (first === 'session') {
    return method === 'GET' && second === 'capabilities' && count === 2
      ? match('sessionCapabilities')
      : undefined;
  }

  if (first === 'summaries') {
    return method === 'POST' && count === 1 ? match('summaries', {}, true) : undefined;
  }

  if (first === 'aws' && second === 'cost-explorer' && count >= 3) {
    const pathParameters: Record<string, string> =
      third === 'reports' && fourth ? { reportId: fourth } : {};
    return match('costExplorer', pathParameters, method === 'POST');
  }

  if (first === 'aws' && second === 'invoices') {
    if (method === 'POST' && third === 'summary' && count === 3) {
      return match('awsInvoiceSummaries', {}, true);
    }
    const pathParameters: Record<string, string> = {};
    if (third === 'uploads' && fourth) pathParameters.jobId = fourth;
    else if (third && third !== 'uploads' && third !== 'dashboard') {
      pathParameters.yearMonth = third;
    }
    return match('awsInvoices', pathParameters, method === 'POST');
  }

  return undefined;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test backend/__tests__/server-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/server/routes.ts backend/__tests__/server-routes.test.ts
git commit -m "feat(server): add shared API route table"
```

---

### Task 2: Cognito access-token verifier

**Files:**
- Create: `backend/server/jwt.ts`
- Modify: `package.json` (move `aws-jwt-verify` from `devDependencies` to `dependencies`)
- Test: `backend/__tests__/server-jwt.test.ts`

**Interfaces:**
- Produces:
  - `interface AuthorizerClaims { sub: string; token_use: 'access'; scope: string; username?: string }`
  - `class AuthError extends Error`
  - `interface AccessTokenVerifier { verify(token: string): Promise<AuthorizerClaims> }`
  - `function bearerToken(headerValue: string | string[] | undefined): string | undefined`
  - `interface VerifierConfig { userPoolId: string; clientIds: string[] }`
  - `function verifierConfigFromEnv(env?: Record<string, string | undefined>): VerifierConfig`
  - `function createAccessTokenVerifier(config: VerifierConfig, options?: { jwks?: { keys: object[] } }): AccessTokenVerifier`

`scripts/local/cognito-auth.ts` has a similar local-only verifier. Leave it alone: it reads `NEXT_PUBLIC_*` variables and has dev-server-specific error text.

- [ ] **Step 1: Move the dependency**

```bash
pnpm remove aws-jwt-verify && pnpm add aws-jwt-verify@^5.2.1
```

Expected: `aws-jwt-verify` now listed under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

Create `backend/__tests__/server-jwt.test.ts`. It signs real RS256 tokens with a throwaway key so the library's checks are exercised, not mocked.

```ts
import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  AuthError,
  bearerToken,
  createAccessTokenVerifier,
  verifierConfigFromEnv,
} from '../server/jwt';

const USER_POOL_ID = 'ap-southeast-1_TestPool';
const ISSUER = `https://cognito-idp.ap-southeast-1.amazonaws.com/${USER_POOL_ID}`;
const CLIENT_ID = 'spa-client';
const KID = 'test-key';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = {
  keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }],
};

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const payload = base64url({
    sub: 'user-123',
    iss: ISSUER,
    client_id: CLIENT_ID,
    token_use: 'access',
    scope: 'cashight/read cashight/write',
    username: 'huy',
    iat: now,
    exp: now + 300,
    ...overrides,
  });
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey)
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const verifier = createAccessTokenVerifier(
  { userPoolId: USER_POOL_ID, clientIds: [CLIENT_ID, 'smoke-client'] },
  { jwks },
);

describe('createAccessTokenVerifier', () => {
  it('returns the claims handlers read', async () => {
    await expect(verifier.verify(signToken())).resolves.toEqual({
      sub: 'user-123',
      token_use: 'access',
      scope: 'cashight/read cashight/write',
      username: 'huy',
    });
  });

  it('accepts any configured client id', async () => {
    const claims = await verifier.verify(signToken({ client_id: 'smoke-client' }));
    expect(claims.sub).toBe('user-123');
  });

  it('omits username when the token has none', async () => {
    const claims = await verifier.verify(signToken({ username: undefined }));
    expect(claims).not.toHaveProperty('username');
  });

  it.each([
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['an ID token', { token_use: 'id', aud: CLIENT_ID }],
    ['a token for another client', { client_id: 'someone-else' }],
    ['a token from another pool', { iss: `${ISSUER}x` }],
    ['a token with a blank sub', { sub: '   ' }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(verifier.verify(signToken(overrides))).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects a tampered signature', async () => {
    const token = signToken();
    await expect(verifier.verify(`${token.slice(0, -4)}AAAA`)).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects garbage', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(AuthError);
  });

  it('does not echo the token in the error message', async () => {
    const token = signToken({ client_id: 'someone-else' });
    const error = await verifier.verify(token).catch((caught: unknown) => caught);
    expect((error as Error).message).not.toContain(token);
  });
});

describe('bearerToken', () => {
  it('extracts a bearer token', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme', () => {
    expect(bearerToken('bearer abc')).toBe('abc');
  });

  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer   '])('returns undefined for %j', (value) => {
    expect(bearerToken(value)).toBeUndefined();
  });

  it('uses the first value of a repeated header', () => {
    expect(bearerToken(['Bearer one', 'Bearer two'])).toBe('one');
  });
});

describe('verifierConfigFromEnv', () => {
  it('reads the pool id and a comma-separated client list', () => {
    expect(
      verifierConfigFromEnv({
        COGNITO_USER_POOL_ID: ' ap-southeast-1_abc ',
        COGNITO_CLIENT_IDS: 'one, two,,',
      }),
    ).toEqual({ userPoolId: 'ap-southeast-1_abc', clientIds: ['one', 'two'] });
  });

  it('throws when the pool id is missing', () => {
    expect(() => verifierConfigFromEnv({ COGNITO_CLIENT_IDS: 'one' })).toThrow(
      'Missing required configuration: COGNITO_USER_POOL_ID',
    );
  });

  it('throws when no client id is configured', () => {
    expect(() =>
      verifierConfigFromEnv({ COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_IDS: ' , ' }),
    ).toThrow('Missing required configuration: COGNITO_CLIENT_IDS');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test backend/__tests__/server-jwt.test.ts`
Expected: FAIL — cannot resolve `../server/jwt`.

- [ ] **Step 4: Write the implementation**

Create `backend/server/jwt.ts`:

```ts
/**
 * Cognito access-token verification for the container HTTP server.
 *
 * API Gateway's Cognito authorizer used to validate the token and attach
 * `requestContext.authorizer.claims`. This produces the same claims object, so
 * backend/shared/auth-claims.ts keeps enforcing scope and token_use unchanged.
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';

import { requiredEnvironmentValue } from '../shared/config';

/** Claims shape the handlers read off `requestContext.authorizer`. */
export interface AuthorizerClaims {
  sub: string;
  token_use: 'access';
  scope: string;
  username?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<AuthorizerClaims>;
}

export interface VerifierConfig {
  userPoolId: string;
  clientIds: string[];
}

type Environment = Record<string, string | undefined>;

/** The bearer token from an `Authorization` header, or undefined. */
export function bearerToken(headerValue: string | string[] | undefined): string | undefined {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

export function verifierConfigFromEnv(env: Environment = process.env): VerifierConfig {
  const userPoolId = requiredEnvironmentValue('COGNITO_USER_POOL_ID', env);
  const clientIds = (env.COGNITO_CLIENT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (clientIds.length === 0) {
    throw new Error('Missing required configuration: COGNITO_CLIENT_IDS');
  }
  return { userPoolId, clientIds };
}

export function createAccessTokenVerifier(
  config: VerifierConfig,
  options: { jwks?: { keys: object[] } } = {},
): AccessTokenVerifier {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    clientId: config.clientIds,
    tokenUse: 'access',
  });
  // Tests inject a JWKS; production fetches and caches the pool's JWKS lazily.
  if (options.jwks) verifier.cacheJwks(options.jwks as never);

  return {
    async verify(token: string): Promise<AuthorizerClaims> {
      let payload: Record<string, unknown>;
      try {
        payload = (await verifier.verify(token)) as Record<string, unknown>;
      } catch (error) {
        // The library's messages name the failed check, never the token.
        const reason = error instanceof Error ? error.name : 'unknown';
        throw new AuthError(`Access token rejected (${reason}).`);
      }
      const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!sub) throw new AuthError('Access token carries no sub claim.');
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      return {
        sub,
        token_use: 'access',
        scope: typeof payload.scope === 'string' ? payload.scope : '',
        ...(username ? { username } : {}),
      };
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test backend/__tests__/server-jwt.test.ts`
Expected: PASS.

If the "ID token" case fails because the library reports a different error class, that is still a rejection — the assertion is `AuthError`, which wraps every library failure. If `cacheJwks` rejects the JWKS shape, print `jwks.keys[0]` and confirm it has `kty`, `n`, `e`, `kid`, `alg`, `use`.

- [ ] **Step 6: Commit**

```bash
git add backend/server/jwt.ts backend/__tests__/server-jwt.test.ts package.json pnpm-lock.yaml
git commit -m "feat(server): verify Cognito access tokens in-process"
```

---

### Task 3: Rate limiter

**Files:**
- Create: `backend/server/rate-limit.ts`
- Test: `backend/__tests__/server-rate-limit.test.ts`

**Interfaces:**
- Produces:
  - `interface RateLimiter { take(): boolean }`
  - `function createRateLimiter(options: { capacity: number; refillPerSecond: number; now?: () => number }): RateLimiter`

This replaces the API Gateway stage throttle (burst 50, rate 100/s). It is one bucket per pod, not per caller: Cashight has a single user, and the goal is a ceiling on work per pod.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/server-rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../server/rate-limit';

describe('createRateLimiter', () => {
  it('allows a burst up to capacity, then refuses', () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => 0 });
    expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('refills over time', () => {
    let clock = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 2, now: () => clock });
    limiter.take();
    limiter.take();
    expect(limiter.take()).toBe(false);
    clock = 500;
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
  });

  it('never exceeds capacity after a long idle period', () => {
    let clock = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 10, now: () => clock });
    clock = 60_000;
    expect([limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, false]);
  });

  it('tolerates a clock that moves backwards', () => {
    let clock = 1_000;
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => clock });
    limiter.take();
    clock = 0;
    expect(limiter.take()).toBe(false);
  });

  it.each([
    [0, 1],
    [1, 0],
    [-1, 1],
    [Number.NaN, 1],
  ])('rejects capacity=%s refill=%s', (capacity, refillPerSecond) => {
    expect(() => createRateLimiter({ capacity, refillPerSecond })).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test backend/__tests__/server-rate-limit.test.ts`
Expected: FAIL — cannot resolve `../server/rate-limit`.

- [ ] **Step 3: Write the implementation**

Create `backend/server/rate-limit.ts`:

```ts
export interface RateLimiter {
  /** Take one token. False means the caller should be refused. */
  take(): boolean;
}

export function createRateLimiter(options: {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}): RateLimiter {
  const { capacity, refillPerSecond, now = Date.now } = options;
  if (!(capacity > 0) || !(refillPerSecond > 0)) {
    throw new RangeError('Rate limiter capacity and refillPerSecond must be positive.');
  }

  let tokens = capacity;
  let last = now();

  return {
    take(): boolean {
      const current = now();
      const elapsedSeconds = Math.max(0, current - last) / 1000;
      last = current;
      tokens = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test backend/__tests__/server-rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/server/rate-limit.ts backend/__tests__/server-rate-limit.test.ts
git commit -m "feat(server): add token-bucket rate limiter"
```

---

### Task 4: Observability adapter and telemetry bootstrap

**Files:**
- Modify: `backend/shared/observability.ts` (whole file)
- Modify: `backend/shared/auth-claims.ts:1`, `backend/functions/dashboard-api/handler.ts:2`, `backend/functions/statements-api/handler.ts:2`, `backend/functions/parser-worker/handler.ts:2`, `backend/functions/upload-status-api/handler.ts:88` (the `MetricUnit` import)
- Modify: `backend/functions/invoice-parser-worker/handler.ts` (`emitAwsInvoiceParseFailureMetric`)
- Create: `backend/server/telemetry.ts`
- Modify: `package.json` (remove Powertools, add OpenTelemetry)
- Test: `backend/__tests__/observability.test.ts`, `backend/__tests__/server-telemetry.test.ts`

**Interfaces:**
- Produces, from `backend/shared/observability.ts`:
  - `const MetricUnit: { readonly Count: 'Count' }`
  - `const metrics: { addMetric(name: string, unit: 'Count', value: number, attributes?: Record<string, string>): void }`
  - `const logger: { info(message: string, fields?: Record<string, unknown>): void; warn(...): void; error(...): void }`
  - `function metricInstrumentName(name: string): string`
  - `function sanitizeForLog(value: unknown): unknown` (unchanged)
- Produces, from `backend/server/telemetry.ts`:
  - `interface Telemetry { enabled: boolean; shutdown(): Promise<void> }`
  - `function startTelemetry(serviceName: string, env?: Record<string, string | undefined>): Telemetry`

**Why replacing Powertools loses nothing in Lambda:** `metrics.addMetric` is the only Powertools call in the backend, and nothing ever calls `publishStoredMetrics()`, so those metrics are never flushed today. The exported `logger` and `tracer` have no callers. No Terraform alarm references these metric names.

**Ordering rule this task creates:** the OTel metrics API returns a no-op meter until a provider is registered. Instruments must therefore be created after `startTelemetry()` has run. `metrics.addMetric` creates its counter on first use, which is always at request time, so it satisfies the rule. Later tasks create instruments inside factory functions for the same reason.

- [ ] **Step 1: Confirm the "loses nothing" claim still holds**

Run: `grep -rnE "publishStoredMetrics|logMetrics|logger\.(info|warn|error|debug)|tracer\." backend --include='*.ts' | grep -v __tests__`
Expected: no output. If there is output, stop and report it; the adapter below must then preserve that call.

- [ ] **Step 2: Swap the dependencies**

```bash
pnpm remove @aws-lambda-powertools/logger @aws-lambda-powertools/metrics @aws-lambda-powertools/tracer
pnpm add @opentelemetry/api @opentelemetry/resources @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http
```

Then confirm the SDK major version: `pnpm list @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics @opentelemetry/resources`
Expected: all three on major version 2. The code in Step 8 uses the 2.x API (`resourceFromAttributes`, the `spanProcessors` constructor option). If a different major is installed, pin `@^2` on those three packages.

- [ ] **Step 3: Write the failing observability test**

Create `backend/__tests__/observability.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MetricUnit,
  logger,
  metricInstrumentName,
  metrics,
} from '../shared/observability';

describe('metricInstrumentName', () => {
  it.each([
    ['LegacyWorkspaceFallback', 'cashight.legacy_workspace_fallback'],
    ['LegacyAuthzFallback', 'cashight.legacy_authz_fallback'],
    ['AwsInvoiceParseFailure', 'cashight.aws_invoice_parse_failure'],
  ])('%s → %s', (name, expected) => {
    expect(metricInstrumentName(name)).toBe(expected);
  });
});

describe('metrics.addMetric', () => {
  it('is safe to call with no telemetry provider registered', () => {
    expect(() => metrics.addMetric('LegacyWorkspaceFallback', MetricUnit.Count, 1)).not.toThrow();
  });
});

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  function capture(): () => Record<string, unknown> {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    return () => JSON.parse(String(write.mock.calls[0][0])) as Record<string, unknown>;
  }

  it('writes one JSON line with level, message and service', () => {
    const read = capture();
    logger.info('request', { route: 'dashboard', status: 200 });
    expect(read()).toMatchObject({
      level: 'info',
      message: 'request',
      service: 'cashight',
      route: 'dashboard',
      status: 200,
    });
  });

  it('drops sensitive fields', () => {
    const read = capture();
    logger.warn('upload', {
      jobId: 'job-1',
      token: 'secret-token',
      email: 'someone@example.com',
      description: 'GRAB*RIDE',
      transactions: [{ amountVnd: 1 }],
    });
    const line = read();
    expect(line.jobId).toBe('job-1');
    expect(line).not.toHaveProperty('token');
    expect(line).not.toHaveProperty('email');
    expect(line).not.toHaveProperty('description');
    expect(line).not.toHaveProperty('transactions');
  });

  it('does not let fields override level or message', () => {
    const read = capture();
    logger.error('boom', { level: 'info', message: 'spoofed' });
    expect(read()).toMatchObject({ level: 'error', message: 'boom' });
  });

  it('ends each line with a newline', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    logger.info('x');
    expect(String(write.mock.calls[0][0]).endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test backend/__tests__/observability.test.ts`
Expected: FAIL — `metricInstrumentName` and `MetricUnit` are not exported (or the Powertools import no longer resolves).

- [ ] **Step 5: Rewrite `backend/shared/observability.ts`**

Replace the whole file. `SENSITIVE_LOG_KEYS`, `isSensitiveLogKey` and `sanitizeForLog` are copied unchanged from the current file.

```ts
import { metrics as otelMetrics, trace, type Counter } from '@opentelemetry/api';
import { redactForLog } from '@cashight/domain/security/logging';

const SENSITIVE_LOG_KEYS = new Set([
  'authorization',
  'body',
  'description',
  'email',
  'name',
  'password',
  'pdf',
  'secret',
  'token',
  'transactions',
  'username',
]);

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return (
    SENSITIVE_LOG_KEYS.has(normalized) ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('email') ||
    normalized.includes('description')
  );
}

export function sanitizeForLog(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name };
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (typeof value !== 'object' || value === null) return redactForLog(value);

  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveLogKey(key)) continue;
    safe[key] = sanitizeForLog(item);
  }
  return safe;
}

const SERVICE = 'cashight';

// ── Metrics ───────────────────────────────────────────────────────────────────

export const MetricUnit = { Count: 'Count' } as const;
export type MetricUnitName = (typeof MetricUnit)[keyof typeof MetricUnit];

/** `LegacyWorkspaceFallback` → `cashight.legacy_workspace_fallback`. */
export function metricInstrumentName(name: string): string {
  return `${SERVICE}.${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;
}

const counters = new Map<string, Counter>();

export const metrics = {
  /**
   * Count an occurrence. Exported through OpenTelemetry when the container
   * runtime has started telemetry; a no-op everywhere else, including Lambda.
   * Attribute values must be low-cardinality and free of personal data.
   */
  addMetric(
    name: string,
    _unit: MetricUnitName,
    value: number,
    attributes?: Record<string, string>,
  ): void {
    let counter = counters.get(name);
    if (!counter) {
      counter = otelMetrics.getMeter(SERVICE).createCounter(metricInstrumentName(name));
      counters.set(name, counter);
    }
    counter.add(value, attributes);
  },
};

// ── Logging ───────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error';

function writeLog(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const spanContext = trace.getActiveSpan()?.spanContext();
  const line = {
    ...(sanitizeForLog(fields) as Record<string, unknown>),
    ...(spanContext ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : {}),
    timestamp: new Date().toISOString(),
    service: SERVICE,
    level,
    message,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** Structured JSON logger. Every field passes through `sanitizeForLog`. */
export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => writeLog('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => writeLog('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => writeLog('error', message, fields),
};
```

- [ ] **Step 6: Point the five `MetricUnit` imports at the adapter**

In each file below, delete the line `import { MetricUnit } from '@aws-lambda-powertools/metrics';` and add `MetricUnit` to the existing observability import.

| File | Existing import becomes |
|---|---|
| `backend/shared/auth-claims.ts` | `import { MetricUnit, metrics } from './observability';` |
| `backend/functions/dashboard-api/handler.ts` | `import { MetricUnit, metrics } from '../../shared/observability';` |
| `backend/functions/statements-api/handler.ts` | `import { MetricUnit, metrics } from '../../shared/observability';` |
| `backend/functions/parser-worker/handler.ts` | `import { MetricUnit, metrics } from '../../shared/observability';` |
| `backend/functions/upload-status-api/handler.ts` | `import { MetricUnit, metrics } from '../../shared/observability';` |

In `upload-status-api/handler.ts` the Powertools import sits near the bottom of the file (around line 88) rather than at the top; delete it there.

Verify: `grep -rn "aws-lambda-powertools" backend scripts lib packages --include='*.ts' --include='*.mjs'`
Expected: no output.

- [ ] **Step 7: Count invoice parse failures through the adapter**

In `backend/functions/invoice-parser-worker/handler.ts`, add the import beside the other `../../shared/` imports:

```ts
import { MetricUnit, metrics } from '../../shared/observability';
```

and add one line at the end of `emitAwsInvoiceParseFailureMetric`, after the `writeMetric(...)` call:

```ts
  metrics.addMetric('AwsInvoiceParseFailure', MetricUnit.Count, 1, { error_code: errorCode });
```

The existing EMF line stays: it is what CloudWatch reads while the Lambda is live.

- [ ] **Step 8: Write the telemetry test and implementation**

Create `backend/__tests__/server-telemetry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { startTelemetry } from '../server/telemetry';

describe('startTelemetry', () => {
  it('is a no-op when no OTLP endpoint is configured', async () => {
    const telemetry = startTelemetry('cashight-api', {});
    expect(telemetry.enabled).toBe(false);
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('treats a blank endpoint as unset', () => {
    expect(startTelemetry('cashight-api', { OTEL_EXPORTER_OTLP_ENDPOINT: '  ' }).enabled).toBe(false);
  });

  it('starts and shuts down cleanly even when the collector is unreachable', async () => {
    const telemetry = startTelemetry('cashight-api', {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
    });
    expect(telemetry.enabled).toBe(true);
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});
```

Run: `pnpm test backend/__tests__/server-telemetry.test.ts`
Expected: FAIL — cannot resolve `../server/telemetry`.

Create `backend/server/telemetry.ts`:

```ts
/**
 * OpenTelemetry bootstrap for the container runtime.
 *
 * Instrumentation is manual on purpose. Auto-instrumentation patches modules
 * at require time, which does not work inside an esbuild bundle, and it would
 * attach URLs and SDK request parameters to spans. Spans and metrics here carry
 * only the attributes the HTTP server and SQS consumer set explicitly.
 *
 * The exporters read OTEL_EXPORTER_OTLP_ENDPOINT themselves. With it unset
 * (Lambda, tests, local runs) nothing is registered and the OTel API no-ops.
 */
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export interface Telemetry {
  enabled: boolean;
  shutdown(): Promise<void>;
}

type Environment = Record<string, string | undefined>;

export function startTelemetry(serviceName: string, env: Environment = process.env): Telemetry {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return { enabled: false, shutdown: async () => undefined };

  const resource = resourceFromAttributes({
    'service.name': serviceName,
    'service.namespace': 'cashight',
    'service.version': env.APP_VERSION?.trim() || 'unknown',
  });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
    ],
  });
  tracerProvider.register();

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 30_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    enabled: true,
    async shutdown(): Promise<void> {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
```

- [ ] **Step 9: Run the full suite, typecheck, lint and the Lambda build**

```bash
pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build:lambdas
```

Expected: all pass; `Built 12 Lambda function(s)`. The pre-existing `sanitizeForLog` test in `backend/__tests__/shared.test.ts` and the invoice worker tests must still pass unchanged.

- [ ] **Step 10: Commit**

```bash
git add backend package.json pnpm-lock.yaml
git commit -m "refactor(observability): replace Powertools with OpenTelemetry adapter"
```

---

### Task 5: HTTP server

**Files:**
- Modify: `backend/shared/api-response.ts:3-7` (the SEC-006 comment and the origin constant)
- Create: `backend/server/http-server.ts`
- Test: `backend/__tests__/allowed-origin.test.ts`, `backend/__tests__/server-http.test.ts`

**Interfaces:**
- Consumes: `matchRoute`, `HandlerName` (Task 1); `AuthError`, `bearerToken`, `AccessTokenVerifier` (Task 2); `RateLimiter` (Task 3); `logger` (Task 4); `ApiError`, `errorResponse`, `ApiResponse` from `backend/shared/api-response.ts`
- Produces, from `backend/shared/api-response.ts`:
  - `function allowedOriginFromEnv(env?: Record<string, string | undefined>): string`
  - `const ALLOWED_ORIGIN: string` (resolved once, when the module loads)
- Produces, from `backend/server/http-server.ts`:
  - `type ApiHandler = (event: unknown) => Promise<ApiResponse>`
  - `interface ApiServerOptions { handlers: Partial<Record<HandlerName, ApiHandler>>; verifier: AccessTokenVerifier; rateLimiter: RateLimiter; isReady?: () => boolean; maxBodyBytes?: number }`
  - `function createApiServer(options: ApiServerOptions): http.Server`

Behaviour, in order, for each request:

1. `GET /healthz` → 200, `GET /readyz` → 200 or 503. No auth, limiter, span or log line.
2. `OPTIONS *` → 204 with the CORS headers API Gateway returned.
3. `GET /health` → 200 `{"status":"ok"}` (the smoke test and the old API Gateway mock).
4. Limiter empty → 429.
5. No route, or a route this service does not own → 404.
6. Missing or invalid token → 401.
7. Body over `maxBodyBytes` (default 1 MiB) → 413.
8. Handler result written as-is; a thrown error → 500 with the standard body.

The allowed origin is configuration because the new stack runs at `cashight-v2.nghuy.link` beside the old one and is later renamed to `cashight.nghuy.link`. Handlers put the header on their own responses through `jsonResponse`, `textResponse` and `errorResponse`, so the value has to change in `api-response.ts`, not only in the server.

- [ ] **Step 1: Write the failing origin test**

Create `backend/__tests__/allowed-origin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ALLOWED_ORIGIN, allowedOriginFromEnv } from '../shared/api-response';

describe('allowedOriginFromEnv', () => {
  it.each([{}, { ALLOWED_ORIGIN: '' }, { ALLOWED_ORIGIN: '   ' }])(
    'defaults to the production origin for %j',
    (env) => {
      expect(allowedOriginFromEnv(env)).toBe('https://cashight.nghuy.link');
    },
  );

  it('accepts the hostname the new stack runs on during the rollout', () => {
    expect(allowedOriginFromEnv({ ALLOWED_ORIGIN: 'https://cashight-v2.nghuy.link' })).toBe(
      'https://cashight-v2.nghuy.link',
    );
  });

  it('ignores surrounding whitespace', () => {
    expect(allowedOriginFromEnv({ ALLOWED_ORIGIN: ' https://cashight-v2.nghuy.link\n' })).toBe(
      'https://cashight-v2.nghuy.link',
    );
  });

  it.each([
    '*',
    'null',
    'https://*.nghuy.link',
    'http://cashight-v2.nghuy.link',
    'cashight-v2.nghuy.link',
    'https://cashight-v2.nghuy.link/',
    'https://cashight-v2.nghuy.link/signin',
    'https://cashight-v2.nghuy.link:443',
    'https://CASHIGHT-V2.nghuy.link',
    'https://cashight.nghuy.link,https://cashight-v2.nghuy.link',
    'https://cashight.nghuy.link https://cashight-v2.nghuy.link',
  ])('refuses %j', (value) => {
    expect(() => allowedOriginFromEnv({ ALLOWED_ORIGIN: value })).toThrow(
      'Invalid configuration: ALLOWED_ORIGIN',
    );
  });
});

describe('ALLOWED_ORIGIN', () => {
  it('is the production origin when the variable is unset, as in every Lambda', () => {
    expect(ALLOWED_ORIGIN).toBe('https://cashight.nghuy.link');
  });
});
```

- [ ] **Step 2: Run the origin test to verify it fails**

Run: `pnpm test backend/__tests__/allowed-origin.test.ts`
Expected: FAIL — `allowedOriginFromEnv` is not a function (and `ALLOWED_ORIGIN` is undefined).

- [ ] **Step 3: Make the origin configurable**

In `backend/shared/api-response.ts`, replace the comment block and constant at the top of the file (lines 3–7, from `// SEC-006:` through `const ALLOWED_ORIGIN = 'https://cashight.nghuy.link';`) with:

```ts
// SEC-006: CORS is locked to exactly one allowed origin per deployment. The
// default is the production hostname and must stay in sync with
// x-amazon-apigateway-cors in terraform/api-openapi.yaml.tftpl. API Gateway
// only injects this header for MOCK integrations (OPTIONS preflight); Lambda
// proxy integrations must set it on every response themselves. The Lambdas
// never set ALLOWED_ORIGIN, so they always use the default. A container
// deployment sets it to the hostname its own frontend is served from.
const DEFAULT_ALLOWED_ORIGIN = 'https://cashight.nghuy.link';

function isSingleHttpsOrigin(value: string): boolean {
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(value)) return false;
  try {
    // Also rejects a default port and anything else a browser would not send.
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/**
 * The one origin allowed to call this deployment. A value that is not a single
 * https origin throws, so a typo stops the process instead of silently
 * breaking or widening CORS.
 */
export function allowedOriginFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env.ALLOWED_ORIGIN?.trim();
  if (!value) return DEFAULT_ALLOWED_ORIGIN;
  if (!isSingleHttpsOrigin(value)) throw new Error('Invalid configuration: ALLOWED_ORIGIN');
  return value;
}

export const ALLOWED_ORIGIN = allowedOriginFromEnv();
```

The three response builders below it already reference `ALLOWED_ORIGIN` and need no change.

Run: `pnpm test backend/__tests__/allowed-origin.test.ts backend/__tests__/shared.test.ts`
Expected: PASS. The existing `API error responses` test in `shared.test.ts` still sees `https://cashight.nghuy.link`, which is the proof that Lambda responses are unchanged.

Confirm no Lambda is given the variable: `grep -rn "ALLOWED_ORIGIN" terraform`
Expected: no output. If Terraform ever sets it on a Lambda, that Lambda's responses would stop matching the origin API Gateway returns on preflight.

- [ ] **Step 4: Write the failing server test**

Create `backend/__tests__/server-http.test.ts`:

```ts
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../shared/api-response';
import { createApiServer, type ApiHandler, type ApiServerOptions } from '../server/http-server';
import { AuthError, type AccessTokenVerifier } from '../server/jwt';

const CLAIMS = { sub: 'user-123', token_use: 'access' as const, scope: 'cashight/read' };

const verifier: AccessTokenVerifier = {
  verify: async (token) => {
    if (token !== 'good') throw new AuthError('Access token rejected (test).');
    return CLAIMS;
  },
};

let server: http.Server | undefined;

async function start(overrides: Partial<ApiServerOptions> = {}): Promise<string> {
  server = createApiServer({
    handlers: { dashboard: async () => jsonResponse(200, { ok: true }) },
    verifier,
    rateLimiter: { take: () => true },
    ...overrides,
  });
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

const auth = { Authorization: 'Bearer good' };

interface ProxyEvent {
  httpMethod: string;
  path: string;
  pathParameters: Record<string, string>;
  queryStringParameters: Record<string, string>;
  body: string | null;
  requestContext: { requestId: string; authorizer: { claims: unknown } };
}

interface ErrorBody {
  error: { code: string; retryable?: boolean };
}

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

describe('probes', () => {
  it('answers /healthz without auth', async () => {
    const res = await fetch(`${await start()}/healthz`);
    expect(res.status).toBe(200);
  });

  it('answers /readyz 503 when not ready', async () => {
    const res = await fetch(`${await start({ isReady: () => false })}/readyz`);
    expect(res.status).toBe(503);
  });

  it('answers probes even when the limiter is empty', async () => {
    const res = await fetch(`${await start({ rateLimiter: { take: () => false } })}/healthz`);
    expect(res.status).toBe(200);
  });

  it('answers /health like the API Gateway mock did', async () => {
    const res = await fetch(`${await start()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://cashight.nghuy.link');
  });
});

describe('CORS', () => {
  it('answers preflight without auth', async () => {
    const res = await fetch(`${await start()}/dashboard`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://cashight.nghuy.link');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, DELETE, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(res.headers.get('access-control-max-age')).toBe('300');
  });

  it('puts the allowed origin on error responses', async () => {
    const res = await fetch(`${await start()}/dashboard`);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://cashight.nghuy.link');
  });
});

describe('authentication', () => {
  it.each([
    ['no header', {}],
    ['a bad token', { Authorization: 'Bearer bad' }],
    ['a non-bearer scheme', { Authorization: 'Basic good' }],
  ])('returns 401 for %s and never calls the handler', async (_label, headers) => {
    const dashboard = vi.fn<ApiHandler>();
    const res = await fetch(`${await start({ handlers: { dashboard } })}/dashboard`, { headers });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('UNAUTHORIZED');
    expect(dashboard).not.toHaveBeenCalled();
  });
});

describe('dispatch', () => {
  it('builds the API Gateway proxy event the handlers expect', async () => {
    const statements = vi.fn<ApiHandler>(async () => jsonResponse(200, {}));
    const base = await start({ handlers: { statements } });
    await fetch(`${base}/statements/9674-2026-05?bank=VIB`, { method: 'DELETE', headers: auth });
    const event = statements.mock.calls[0][0] as ProxyEvent;
    expect(event.httpMethod).toBe('DELETE');
    expect(event.path).toBe('/statements/9674-2026-05');
    expect(event.pathParameters).toEqual({ statementId: '9674-2026-05' });
    expect(event.queryStringParameters).toEqual({ bank: 'VIB' });
    expect(event.body).toBeNull();
    expect(event.requestContext.authorizer.claims).toEqual(CLAIMS);
    expect(event.requestContext.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('passes the request body as a string', async () => {
    const uploads = vi.fn<ApiHandler>(async () => jsonResponse(201, {}));
    const base = await start({ handlers: { uploads } });
    const res = await fetch(`${base}/uploads`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'a.pdf' }),
    });
    expect(res.status).toBe(201);
    expect((uploads.mock.calls[0][0] as ProxyEvent).body).toBe('{"fileName":"a.pdf"}');
  });

  it('returns the handler status, headers and body unchanged', async () => {
    const base = await start({
      handlers: { dashboard: async () => jsonResponse(409, { error: { code: 'CONFLICT' } }) },
    });
    const res = await fetch(`${base}/dashboard`, { headers: auth });
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ error: { code: 'CONFLICT' } });
  });

  it('returns 404 for a route owned by the other service', async () => {
    const res = await fetch(`${await start()}/aws/invoices`, { headers: auth });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('NOT_FOUND');
  });

  it('returns 404 for a malformed percent-encoded path', async () => {
    const statements = vi.fn<ApiHandler>();
    const base = await start({ handlers: { statements } });
    const res = await fetch(`${base}/statements/%E0%A4%A`, { headers: auth });
    expect(res.status).toBe(404);
    expect(statements).not.toHaveBeenCalled();
  });

  it('returns 404 for an unsupported method', async () => {
    const res = await fetch(`${await start()}/dashboard`, { method: 'PUT', headers: auth });
    expect(res.status).toBe(404);
  });
});

describe('limits and failures', () => {
  it('returns 429 with Retry-After when the limiter is empty', async () => {
    const dashboard = vi.fn<ApiHandler>();
    const base = await start({ handlers: { dashboard }, rateLimiter: { take: () => false } });
    const res = await fetch(`${base}/dashboard`, { headers: auth });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('1');
    expect(await errorOf(res)).toMatchObject({ code: 'TOO_MANY_REQUESTS', retryable: true });
    expect(dashboard).not.toHaveBeenCalled();
  });

  it('returns 413 for a body over the limit and never calls the handler', async () => {
    const uploads = vi.fn<ApiHandler>();
    const base = await start({ handlers: { uploads }, maxBodyBytes: 16 });
    const res = await fetch(`${base}/uploads`, {
      method: 'POST',
      headers: auth,
      body: 'x'.repeat(1024),
    });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('PAYLOAD_TOO_LARGE');
    expect(uploads).not.toHaveBeenCalled();
  });

  it('returns a generic 500 when a handler throws, without leaking the message', async () => {
    const base = await start({
      handlers: {
        dashboard: async () => {
          throw new Error('card 4111111111111111 exploded');
        },
      },
    });
    const res = await fetch(`${base}/dashboard`, { headers: auth });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect((JSON.parse(text) as ErrorBody).error.code).toBe('INTERNAL_ERROR');
    expect(text).not.toContain('4111');
  });

  it('never logs the query string, token or thrown message', async () => {
    const base = await start({
      handlers: {
        dashboard: async () => {
          throw new Error('card 4111111111111111 exploded');
        },
      },
    });
    await fetch(`${base}/dashboard?secretish=zzz`, { headers: auth });
    const logged = vi.mocked(process.stdout.write).mock.calls.map((call) => String(call[0])).join('');
    expect(logged).toContain('"route":"dashboard"');
    expect(logged).not.toContain('zzz');
    expect(logged).not.toContain('good');
    expect(logged).not.toContain('4111');
  });
});
```

- [ ] **Step 5: Run the server test to verify it fails**

Run: `pnpm test backend/__tests__/server-http.test.ts`
Expected: FAIL — cannot resolve `../server/http-server`.

- [ ] **Step 6: Write the implementation**

Create `backend/server/http-server.ts`:

```ts
/**
 * HTTP front end for the API handlers when they run in a container.
 *
 * It does what API Gateway did around each Lambda: CORS preflight, throttling,
 * token verification, routing, and building the proxy event. Handlers are the
 * same functions the Lambdas export and are not aware of the difference.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';

import { SpanStatusCode, metrics as otelMetrics, trace } from '@opentelemetry/api';

import {
  ALLOWED_ORIGIN,
  ApiError,
  errorResponse,
  type ApiResponse,
} from '../shared/api-response';
import { logger } from '../shared/observability';
import {
  AuthError,
  bearerToken,
  type AccessTokenVerifier,
  type AuthorizerClaims,
} from './jwt';
import type { RateLimiter } from './rate-limit';
import { matchRoute, type HandlerName } from './routes';

export type ApiHandler = (event: unknown) => Promise<ApiResponse>;

export interface ApiServerOptions {
  /** Only the handlers this service owns; other routes answer 404. */
  handlers: Partial<Record<HandlerName, ApiHandler>>;
  verifier: AccessTokenVerifier;
  rateLimiter: RateLimiter;
  isReady?: () => boolean;
  maxBodyBytes?: number;
}

// Methods, headers and max-age mirror x-amazon-apigateway-cors in
// terraform/api-openapi.yaml.tftpl; keep them in sync until API Gateway is
// removed. The origin is this deployment's single allowed origin (SEC-006).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token',
  'Access-Control-Max-Age': '300',
} as const;

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {}

interface Outcome {
  status: number;
  route: string;
}

function readBody(request: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Stop buffering but keep draining so the 413 can be delivered.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) reject(new PayloadTooLargeError());
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function write(
  response: http.ServerResponse,
  result: ApiResponse,
  extraHeaders: Record<string, string> = {},
): number {
  response.writeHead(result.statusCode, { ...result.headers, ...extraHeaders });
  response.end(result.body);
  return result.statusCode;
}

function writeError(
  response: http.ServerResponse,
  requestId: string,
  error: ApiError,
  extraHeaders: Record<string, string> = {},
): number {
  return write(response, errorResponse(error, requestId), extraHeaders);
}

export function createApiServer(options: ApiServerOptions): http.Server {
  const {
    handlers,
    verifier,
    rateLimiter,
    isReady = () => true,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  } = options;

  // Created here, not at module scope: instruments made before telemetry
  // starts are permanently no-ops.
  const duration = otelMetrics
    .getMeter('cashight')
    .createHistogram('http.server.request.duration', { unit: 's' });
  const tracer = trace.getTracer('cashight');

  async function dispatch(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    requestId: string,
    onRoute: (name: string) => void,
  ): Promise<Outcome> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://internal');

    if (method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return { status: 204, route: 'preflight' };
    }

    if (method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      });
      response.end('{"status":"ok"}');
      return { status: 200, route: 'health' };
    }

    if (!rateLimiter.take()) {
      const status = writeError(
        response,
        requestId,
        new ApiError('TOO_MANY_REQUESTS', 429, 'Too many requests.', true),
        { 'Retry-After': '1' },
      );
      return { status, route: 'throttled' };
    }

    const match = matchRoute(method, url.pathname);
    const handler = match ? handlers[match.handler] : undefined;
    if (!match || !handler) {
      const status = writeError(
        response,
        requestId,
        new ApiError('NOT_FOUND', 404, 'No such route.'),
      );
      return { status, route: 'unmatched' };
    }
    const route = match.handler;
    // Reported before the handler runs so a thrown error is still attributed.
    onRoute(route);

    let claims: AuthorizerClaims;
    try {
      const token = bearerToken(request.headers.authorization);
      if (!token) throw new AuthError('Missing bearer token.');
      claims = await verifier.verify(token);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      const status = writeError(
        response,
        requestId,
        new ApiError('UNAUTHORIZED', 401, 'Authentication is required.'),
      );
      return { status, route };
    }

    let body: string | null = null;
    if (match.readsBody) {
      try {
        body = await readBody(request, maxBodyBytes);
      } catch (error) {
        if (!(error instanceof PayloadTooLargeError)) throw error;
        const status = writeError(
          response,
          requestId,
          new ApiError('PAYLOAD_TOO_LARGE', 413, 'The request body is too large.'),
          { Connection: 'close' },
        );
        return { status, route };
      }
    }

    const result = await handler({
      httpMethod: method,
      path: url.pathname,
      pathParameters: match.pathParameters,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      headers: request.headers,
      body,
      requestContext: { requestId, authorizer: { claims } },
    });
    return { status: write(response, result), route };
  }

  const server = http.createServer((request, response) => {
    const method = request.method ?? 'GET';
    const pathname = (request.url ?? '/').split('?')[0];

    // Probes stay out of traces, metrics and logs.
    if (method === 'GET' && pathname === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ok"}');
      return;
    }
    if (method === 'GET' && pathname === '/readyz') {
      const ready = isReady();
      response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(ready ? '{"status":"ready"}' : '{"status":"draining"}');
      return;
    }

    const requestId = randomUUID();
    const started = process.hrtime.bigint();

    void tracer.startActiveSpan('http.request', async (span) => {
      let outcome: Outcome = { status: 500, route: 'unmatched' };
      try {
        outcome = await dispatch(request, response, requestId, (name) => {
          outcome = { status: 500, route: name };
        });
      } catch (error) {
        // Name only: messages and stacks can carry statement data.
        const errorName = error instanceof Error ? error.name : 'unknown';
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorName });
        logger.error('unhandled request error', { requestId, errorName });
        if (!response.headersSent) {
          writeError(response, requestId, new ApiError('INTERNAL_ERROR', 500, 'An unexpected error occurred.'));
        } else {
          response.end();
        }
      } finally {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        const attributes = {
          'http.request.method': method,
          'http.route': outcome.route,
          'http.response.status_code': outcome.status,
        };
        span.updateName(`${method} ${outcome.route}`);
        span.setAttributes(attributes);
        if (outcome.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        duration.record(seconds, attributes);
        logger.info('request', {
          requestId,
          method,
          route: outcome.route,
          status: outcome.status,
          durationMs: Math.round(seconds * 1000),
        });
      }
    });
  });

  // An ALB keeps idle connections for 60 s. Node must outlast it, or the ALB
  // reuses a socket Node has just closed and returns a 502.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  return server;
}
```

- [ ] **Step 7: Run the server test to verify it passes**

Run: `pnpm test backend/__tests__/server-http.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint and rebuild the Lambdas**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm build:lambdas`
Expected: all pass. The Lambda build is here because `api-response.ts` is bundled into every API Lambda.

- [ ] **Step 9: Commit**

```bash
git add backend/server/http-server.ts backend/shared/api-response.ts backend/__tests__/server-http.test.ts backend/__tests__/allowed-origin.test.ts
git commit -m "feat(server): add HTTP front end for API handlers"
```

---

### Task 6: SQS consumer

**Files:**
- Create: `backend/server/sqs-consumer.ts`
- Test: `backend/__tests__/server-sqs-consumer.test.ts`

**Interfaces:**
- Consumes: `logger` (Task 4)
- Produces:
  - `interface QueueRecord { messageId: string; body: string }`
  - `type BatchHandler = (event: { Records: QueueRecord[] }) => Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }>`
  - `interface SqsConsumerOptions { client: { send(command: any, options?: { abortSignal?: AbortSignal }): Promise<any> }; queueUrl: string; handler: BatchHandler; maxProcessingMs: number; onFatal: (error: Error) => void; waitTimeSeconds?: number; errorBackoffMs?: number; sleep?: (ms: number) => Promise<void> }`
  - `interface SqsConsumer { start(): Promise<void>; stop(): void }`
  - `function createSqsConsumer(options: SqsConsumerOptions): SqsConsumer`

Semantics, chosen to match the Lambda event source mapping (`batch_size = 1`, `ReportBatchItemFailures`):

- One message at a time. An empty `batchItemFailures` deletes the message; anything else leaves it for SQS to redeliver, and the existing redrive policy moves it to the DLQ after 3 receives.
- **Deviation from spec §4.3, which said the worker "extends visibility while working".** The queue's visibility timeout (360 s) already exceeds the longest allowed job (300 s), so a heartbeat adds nothing. Instead the consumer enforces `maxProcessingMs` the way Lambda enforced its timeout: on expiry it calls `onFatal`, the process exits, Kubernetes restarts the pod, and SQS redelivers.
- `stop()` aborts the idle long poll immediately but lets an in-flight job finish and delete its message.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/server-sqs-consumer.test.ts`:

```ts
import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSqsConsumer, type BatchHandler, type SqsConsumer } from '../server/sqs-consumer';

const QUEUE_URL = 'https://sqs.ap-southeast-1.amazonaws.com/123/parse';

interface Message {
  MessageId?: string;
  Body?: string;
  ReceiptHandle?: string;
}

const message = (id: string): Message => ({
  MessageId: id,
  Body: `{"id":"${id}"}`,
  ReceiptHandle: `rh-${id}`,
});

/**
 * A fake SQS client that hands out the scripted receives, then stops the
 * consumer so `start()` resolves.
 */
function harness(script: Array<Message[] | Error>, handler: BatchHandler, extra = {}) {
  const deleted: string[] = [];
  const receives: Array<Record<string, unknown>> = [];
  const onFatal = vi.fn();
  const sleep = vi.fn(async () => undefined);
  const ref: { consumer?: SqsConsumer } = {};

  const client = {
    async send(command: unknown) {
      if (command instanceof DeleteMessageCommand) {
        deleted.push(command.input.ReceiptHandle as string);
        return {};
      }
      if (command instanceof ReceiveMessageCommand) {
        receives.push(command.input as Record<string, unknown>);
        const next = script.shift();
        if (next === undefined) {
          ref.consumer?.stop();
          return { Messages: [] };
        }
        if (next instanceof Error) throw next;
        return { Messages: next };
      }
      throw new Error('unexpected command');
    },
  };

  const consumer = createSqsConsumer({
    client,
    queueUrl: QUEUE_URL,
    handler,
    maxProcessingMs: 1_000,
    onFatal,
    sleep,
    ...extra,
  });
  ref.consumer = consumer;
  return { consumer, deleted, receives, onFatal, sleep };
}

const ok: BatchHandler = async () => ({ batchItemFailures: [] });

afterEach(() => vi.restoreAllMocks());

function silenceLogs(): void {
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
}

describe('createSqsConsumer', () => {
  it('long-polls one message at a time', async () => {
    silenceLogs();
    const { consumer, receives } = harness([], ok);
    await consumer.start();
    expect(receives[0]).toMatchObject({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
    });
  });

  it('passes the handler a Lambda-shaped event and deletes on success', async () => {
    silenceLogs();
    const handler = vi.fn(ok);
    const { consumer, deleted } = harness([[message('m1')]], handler);
    await consumer.start();
    expect(handler).toHaveBeenCalledWith({ Records: [{ messageId: 'm1', body: '{"id":"m1"}' }] });
    expect(deleted).toEqual(['rh-m1']);
  });

  it('leaves the message when the handler reports a failure', async () => {
    silenceLogs();
    const { consumer, deleted } = harness([[message('m1')]], async () => ({
      batchItemFailures: [{ itemIdentifier: 'm1' }],
    }));
    await consumer.start();
    expect(deleted).toEqual([]);
  });

  it('leaves the message when the handler throws, and keeps consuming', async () => {
    silenceLogs();
    const handler = vi
      .fn<BatchHandler>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ batchItemFailures: [] });
    const { consumer, deleted } = harness([[message('m1')], [message('m2')]], handler);
    await consumer.start();
    expect(deleted).toEqual(['rh-m2']);
  });

  it('leaves a message that is missing its id, body or receipt handle', async () => {
    silenceLogs();
    const handler = vi.fn(ok);
    const { consumer, deleted } = harness([[{ MessageId: 'm1' }]], handler);
    await consumer.start();
    expect(handler).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('backs off after a receive error, then continues', async () => {
    silenceLogs();
    const { consumer, deleted, sleep } = harness(
      [new Error('throttled'), [message('m1')]],
      ok,
      { errorBackoffMs: 5_000 },
    );
    await consumer.start();
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(deleted).toEqual(['rh-m1']);
  });

  it('calls onFatal and does not delete when a job exceeds maxProcessingMs', async () => {
    silenceLogs();
    const { consumer, deleted, onFatal } = harness(
      [[message('m1')]],
      () => new Promise(() => undefined),
      { maxProcessingMs: 10 },
    );
    await consumer.start();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0].message).toContain('exceeded');
    expect(deleted).toEqual([]);
  });

  it('stops consuming after onFatal', async () => {
    silenceLogs();
    const handler = vi.fn<BatchHandler>(() => new Promise(() => undefined));
    const { consumer } = harness([[message('m1')], [message('m2')]], handler, {
      maxProcessingMs: 10,
    });
    await consumer.start();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lets an in-flight job finish and delete its message when stopped', async () => {
    silenceLogs();
    const inFlight: { release?: () => void } = {};
    const handler = vi.fn<BatchHandler>(
      () =>
        new Promise((resolve) => {
          inFlight.release = () => resolve({ batchItemFailures: [] });
        }),
    );
    const { consumer, deleted } = harness([[message('m1')], [message('m2')]], handler);
    const running = consumer.start();
    await vi.waitFor(() => expect(inFlight.release).toBeDefined());
    consumer.stop();
    inFlight.release?.();
    await running;
    expect(deleted).toEqual(['rh-m1']);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never logs the message body', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { consumer } = harness([[message('m1')]], async () => {
      throw new Error('boom');
    });
    await consumer.start();
    const logged = write.mock.calls.map((call) => String(call[0])).join('');
    expect(logged).toContain('m1');
    expect(logged).not.toContain('{\\"id\\"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test backend/__tests__/server-sqs-consumer.test.ts`
Expected: FAIL — cannot resolve `../server/sqs-consumer`.

- [ ] **Step 3: Write the implementation**

Create `backend/server/sqs-consumer.ts`:

```ts
/**
 * Queue front end for the worker handlers when they run in a container.
 *
 * It stands in for the Lambda SQS event source mapping (batch size 1,
 * ReportBatchItemFailures): poll, hand one record to the unchanged handler,
 * delete on success, and leave failures for SQS to redeliver and eventually
 * move to the DLQ.
 */
import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { SpanStatusCode, metrics as otelMetrics, trace } from '@opentelemetry/api';

import { logger } from '../shared/observability';

export interface QueueRecord {
  messageId: string;
  body: string;
}

export type BatchHandler = (event: {
  Records: QueueRecord[];
}) => Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }>;

export interface SqsConsumerOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK's send() overloads do not narrow through a structural type
  client: { send(command: any, options?: { abortSignal?: AbortSignal }): Promise<any> };
  queueUrl: string;
  handler: BatchHandler;
  /** Hard limit per job, mirroring the Lambda timeout. Must stay below the queue's visibility timeout. */
  maxProcessingMs: number;
  /** Called once when a job exceeds maxProcessingMs. The process should exit. */
  onFatal: (error: Error) => void;
  waitTimeSeconds?: number;
  errorBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SqsConsumer {
  /** Resolves when the loop has stopped and any in-flight job has finished. */
  start(): Promise<void>;
  stop(): void;
}

type Outcome = 'succeeded' | 'failed' | 'timed_out';

const TIMED_OUT = Symbol('timed-out');

export function createSqsConsumer(options: SqsConsumerOptions): SqsConsumer {
  const {
    client,
    queueUrl,
    handler,
    maxProcessingMs,
    onFatal,
    waitTimeSeconds = 20,
    errorBackoffMs = 5_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  // Created here, not at module scope: see backend/server/telemetry.ts.
  const meter = otelMetrics.getMeter('cashight');
  const jobs = meter.createCounter('cashight.worker.jobs');
  const duration = meter.createHistogram('cashight.worker.job.duration', { unit: 's' });
  const tracer = trace.getTracer('cashight');

  let stopped = false;
  const pollAbort = new AbortController();

  async function runJob(record: QueueRecord, receiptHandle: string): Promise<Outcome> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), maxProcessingMs);
    });

    try {
      const result = await Promise.race([handler({ Records: [record] }), timeout]);
      if (result === TIMED_OUT) return 'timed_out';
      if (result.batchItemFailures.length > 0) return 'failed';
      await client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
      );
      return 'succeeded';
    } catch (error) {
      logger.error('job threw', {
        messageId: record.messageId,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleMessage(message: {
    MessageId?: string;
    Body?: string;
    ReceiptHandle?: string;
  }): Promise<void> {
    const { MessageId: messageId, Body: body, ReceiptHandle: receiptHandle } = message;
    if (!messageId || !body || !receiptHandle) {
      logger.warn('skipping malformed queue message', { messageId: messageId ?? 'unknown' });
      return;
    }

    const started = Date.now();
    await tracer.startActiveSpan('worker.job', async (span) => {
      const outcome = await runJob({ messageId, body }, receiptHandle);
      const seconds = (Date.now() - started) / 1000;
      span.setAttribute('cashight.worker.outcome', outcome);
      if (outcome !== 'succeeded') span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      jobs.add(1, { outcome });
      duration.record(seconds, { outcome });
      logger.info('job', { messageId, outcome, durationMs: Math.round(seconds * 1000) });

      if (outcome === 'timed_out') {
        stopped = true;
        onFatal(new Error(`Job exceeded ${maxProcessingMs} ms; exiting so the message is redelivered.`));
      }
    });
  }

  return {
    async start(): Promise<void> {
      while (!stopped) {
        let messages: Array<{ MessageId?: string; Body?: string; ReceiptHandle?: string }>;
        try {
          const response = await client.send(
            new ReceiveMessageCommand({
              QueueUrl: queueUrl,
              MaxNumberOfMessages: 1,
              WaitTimeSeconds: waitTimeSeconds,
            }),
            { abortSignal: pollAbort.signal },
          );
          messages = response.Messages ?? [];
        } catch (error) {
          if (stopped) break;
          logger.error('receive failed', {
            errorName: error instanceof Error ? error.name : 'unknown',
          });
          await sleep(errorBackoffMs);
          continue;
        }

        for (const message of messages) {
          await handleMessage(message);
        }
      }
    },

    stop(): void {
      stopped = true;
      pollAbort.abort();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test backend/__tests__/server-sqs-consumer.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add backend/server/sqs-consumer.ts backend/__tests__/server-sqs-consumer.test.ts
git commit -m "feat(server): add SQS consumer for worker handlers"
```

---

### Task 7: Entrypoints and bundle build

**Files:**
- Create: `backend/server/start-api.ts`, `backend/server/start-worker.ts`
- Create: `backend/server/entrypoints/api.ts`, `aws-api.ts`, `parser-worker.ts`, `invoice-parser-worker.ts`
- Create: `scripts/build-servers.mjs`
- Modify: `package.json` (add the `build:servers` script)
- Test: `backend/__tests__/server-start.test.ts`, `scripts/__tests__/build-servers.test.mjs`

**Interfaces:**
- Consumes: `createApiServer`, `ApiHandler` (Task 5); `createSqsConsumer`, `BatchHandler` (Task 6); `startTelemetry` (Task 4); `createAccessTokenVerifier`, `verifierConfigFromEnv` (Task 2); `createRateLimiter` (Task 3); `sqsClient` from `backend/shared/clients.ts`; each function's exported `handler`
- Produces:
  - `function apiConfigFromEnv(env?): { port: number; rateLimitBurst: number; rateLimitPerSecond: number; shutdownDelayMs: number }`
  - `function workerConfigFromEnv(env?): { queueUrl: string; maxProcessingMs: number }`
  - `function startApiService(serviceName: string, handlers: Partial<Record<HandlerName, ApiHandler>>): Promise<void>`
  - `function startWorkerService(serviceName: string, handler: BatchHandler): Promise<void>`
  - `export async function buildServers({ projectRoot? }): Promise<{ serverNames: string[]; outputRoot: string }>`
  - Build output: `dist/servers/{api,aws-api,parser-worker,invoice-parser-worker}/index.js`, plus `pdf.worker.mjs` in the two worker directories

- [ ] **Step 1: Write the failing config test**

Create `backend/__tests__/server-start.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { apiConfigFromEnv } from '../server/start-api';
import { workerConfigFromEnv } from '../server/start-worker';

describe('apiConfigFromEnv', () => {
  it('uses the API Gateway throttle values as defaults', () => {
    expect(apiConfigFromEnv({})).toEqual({
      port: 8080,
      rateLimitBurst: 50,
      rateLimitPerSecond: 100,
      shutdownDelayMs: 5_000,
    });
  });

  it('reads overrides', () => {
    expect(
      apiConfigFromEnv({
        PORT: '9000',
        RATE_LIMIT_BURST: '5',
        RATE_LIMIT_PER_SECOND: '2',
        SHUTDOWN_DELAY_MS: '0',
      }),
    ).toEqual({ port: 9000, rateLimitBurst: 5, rateLimitPerSecond: 2, shutdownDelayMs: 0 });
  });

  it.each(['abc', '-1', '1.5', ''])('rejects PORT=%j', (value) => {
    expect(() => apiConfigFromEnv({ PORT: value })).toThrow('Invalid configuration: PORT');
  });
});

describe('workerConfigFromEnv', () => {
  it('reads the queue URL and converts seconds to milliseconds', () => {
    expect(
      workerConfigFromEnv({ QUEUE_URL: 'https://sqs/q', MAX_PROCESSING_SECONDS: '120' }),
    ).toEqual({ queueUrl: 'https://sqs/q', maxProcessingMs: 120_000 });
  });

  it('requires the queue URL', () => {
    expect(() => workerConfigFromEnv({ MAX_PROCESSING_SECONDS: '120' })).toThrow(
      'Missing required configuration: QUEUE_URL',
    );
  });

  it('requires a processing limit', () => {
    expect(() => workerConfigFromEnv({ QUEUE_URL: 'https://sqs/q' })).toThrow(
      'Missing required configuration: MAX_PROCESSING_SECONDS',
    );
  });

  it('refuses a limit at or above the 360 s visibility timeout', () => {
    expect(() =>
      workerConfigFromEnv({ QUEUE_URL: 'https://sqs/q', MAX_PROCESSING_SECONDS: '360' }),
    ).toThrow('Invalid configuration: MAX_PROCESSING_SECONDS');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test backend/__tests__/server-start.test.ts`
Expected: FAIL — cannot resolve `../server/start-api`.

- [ ] **Step 3: Write `start-api.ts`**

Create `backend/server/start-api.ts`:

```ts
import { logger } from '../shared/observability';
import { createApiServer, type ApiHandler } from './http-server';
import { createAccessTokenVerifier, verifierConfigFromEnv } from './jwt';
import { createRateLimiter } from './rate-limit';
import type { HandlerName } from './routes';
import { startTelemetry } from './telemetry';

type Environment = Record<string, string | undefined>;

function integerFromEnv(env: Environment, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`Invalid configuration: ${name}`);
  return Number(raw.trim());
}

export function apiConfigFromEnv(env: Environment = process.env) {
  return {
    port: integerFromEnv(env, 'PORT', 8080),
    // Defaults mirror the API Gateway stage throttle in terraform/api.tf.
    rateLimitBurst: integerFromEnv(env, 'RATE_LIMIT_BURST', 50),
    rateLimitPerSecond: integerFromEnv(env, 'RATE_LIMIT_PER_SECOND', 100),
    // Time for the load balancer to stop routing here after readiness fails.
    shutdownDelayMs: integerFromEnv(env, 'SHUTDOWN_DELAY_MS', 5_000),
  };
}

export async function startApiService(
  serviceName: string,
  handlers: Partial<Record<HandlerName, ApiHandler>>,
): Promise<void> {
  const config = apiConfigFromEnv();
  const verifierConfig = verifierConfigFromEnv();
  // Telemetry first: instruments created before it are permanent no-ops.
  const telemetry = startTelemetry(serviceName);

  let ready = true;
  const server = createApiServer({
    handlers,
    verifier: createAccessTokenVerifier(verifierConfig),
    rateLimiter: createRateLimiter({
      capacity: config.rateLimitBurst,
      refillPerSecond: config.rateLimitPerSecond,
    }),
    isReady: () => ready,
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    logger.info('shutting down', { signal });
    setTimeout(() => {
      server.close(() => {
        void telemetry.shutdown().finally(() => process.exit(0));
      });
      server.closeIdleConnections();
    }, config.shutdownDelayMs);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  logger.info('listening', {
    serviceName,
    port: config.port,
    routes: Object.keys(handlers).join(','),
    telemetry: telemetry.enabled,
  });
}
```

- [ ] **Step 4: Write `start-worker.ts`**

Create `backend/server/start-worker.ts`:

```ts
import { sqsClient } from '../shared/clients';
import { requiredEnvironmentValue } from '../shared/config';
import { logger } from '../shared/observability';
import { createSqsConsumer, type BatchHandler } from './sqs-consumer';
import { startTelemetry } from './telemetry';

type Environment = Record<string, string | undefined>;

/** terraform/data.tf sets visibility_timeout_seconds = 360 on both queues. */
const QUEUE_VISIBILITY_TIMEOUT_SECONDS = 360;

export function workerConfigFromEnv(env: Environment = process.env) {
  const queueUrl = requiredEnvironmentValue('QUEUE_URL', env);
  const raw = requiredEnvironmentValue('MAX_PROCESSING_SECONDS', env);
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(seconds > 0) || seconds >= QUEUE_VISIBILITY_TIMEOUT_SECONDS) {
    throw new Error('Invalid configuration: MAX_PROCESSING_SECONDS');
  }
  return { queueUrl, maxProcessingMs: seconds * 1000 };
}

export async function startWorkerService(
  serviceName: string,
  handler: BatchHandler,
): Promise<void> {
  const config = workerConfigFromEnv();
  const telemetry = startTelemetry(serviceName);

  let exitCode = 0;
  const consumer = createSqsConsumer({
    client: sqsClient,
    queueUrl: config.queueUrl,
    handler,
    maxProcessingMs: config.maxProcessingMs,
    onFatal: (error) => {
      logger.error('fatal worker error', { reason: error.message });
      exitCode = 1;
    },
  });

  const stop = (signal: string): void => {
    logger.info('shutting down', { signal });
    consumer.stop();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  logger.info('consuming', { serviceName, telemetry: telemetry.enabled });
  await consumer.start();
  await telemetry.shutdown();
  // A timed-out job is still running; exiting is what releases it.
  process.exit(exitCode);
}
```

- [ ] **Step 5: Run the config test to verify it passes**

Run: `pnpm test backend/__tests__/server-start.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the four entrypoints**

Each entrypoint catches a startup failure, logs it, and exits non-zero, so a misconfigured pod crash-loops visibly.

Create `backend/server/entrypoints/api.ts`:

```ts
import { handler as dashboard } from '../../functions/dashboard-api/handler';
import { handler as sessionCapabilities } from '../../functions/session-capabilities-api/handler';
import { handler as statements } from '../../functions/statements-api/handler';
import { handler as summaries } from '../../functions/summary-api/handler';
import { handler as uploadStatus } from '../../functions/upload-status-api/handler';
import { handler as uploads } from '../../functions/uploads-api/handler';
import { logger } from '../../shared/observability';
import { startApiService } from '../start-api';

startApiService('cashight-api', {
  uploads,
  uploadStatus,
  statements,
  dashboard,
  sessionCapabilities,
  summaries,
}).catch((error: unknown) => {
  logger.error('startup failed', { reason: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
```

Create `backend/server/entrypoints/aws-api.ts`:

```ts
import { handler as awsInvoiceSummaries } from '../../functions/aws-invoice-summary-api/handler';
import { handler as awsInvoices } from '../../functions/aws-invoices-api/handler';
import { handler as costExplorer } from '../../functions/cost-explorer-api/handler';
import { logger } from '../../shared/observability';
import { startApiService } from '../start-api';

startApiService('cashight-aws-api', {
  costExplorer,
  awsInvoices,
  awsInvoiceSummaries,
}).catch((error: unknown) => {
  logger.error('startup failed', { reason: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
```

Create `backend/server/entrypoints/parser-worker.ts`:

```ts
import { handler } from '../../functions/parser-worker/handler';
import { logger } from '../../shared/observability';
import { startWorkerService } from '../start-worker';

startWorkerService('cashight-parser-worker', handler).catch((error: unknown) => {
  logger.error('startup failed', { reason: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
```

Create `backend/server/entrypoints/invoice-parser-worker.ts`:

```ts
import { handler } from '../../functions/invoice-parser-worker/handler';
import { logger } from '../../shared/observability';
import { startWorkerService } from '../start-worker';

startWorkerService('cashight-invoice-parser-worker', handler).catch((error: unknown) => {
  logger.error('startup failed', { reason: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
```

The startup `reason` values are configuration names such as `Missing required configuration: QUEUE_URL`; they contain no secrets.

- [ ] **Step 7: Write the failing build test**

Create `scripts/__tests__/build-servers.test.mjs`:

```js
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildServers } from '../build-servers.mjs';

describe('buildServers', () => {
  it('bundles the four entrypoints and ships the pdf worker with both workers', async () => {
    const { serverNames, outputRoot } = await buildServers();

    expect(serverNames).toEqual(['api', 'aws-api', 'invoice-parser-worker', 'parser-worker']);
    for (const name of serverNames) {
      const bundle = path.join(outputRoot, name, 'index.js');
      expect(existsSync(bundle), bundle).toBe(true);
      expect(statSync(bundle).size).toBeGreaterThan(10_000);
    }
    for (const name of ['parser-worker', 'invoice-parser-worker']) {
      expect(existsSync(path.join(outputRoot, name, 'pdf.worker.mjs'))).toBe(true);
    }
    for (const name of ['api', 'aws-api']) {
      expect(existsSync(path.join(outputRoot, name, 'pdf.worker.mjs'))).toBe(false);
    }
  }, 120_000);
});
```

Run: `pnpm test scripts/__tests__/build-servers.test.mjs`
Expected: FAIL — cannot resolve `../build-servers.mjs`.

- [ ] **Step 8: Write the build script**

Create `scripts/build-servers.mjs`:

```js
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, '..');

/** Container entrypoints. The two workers load pdfjs and need its worker file. */
const SERVERS = [
  { name: 'api', needsPdfWorker: false },
  { name: 'aws-api', needsPdfWorker: false },
  { name: 'invoice-parser-worker', needsPdfWorker: true },
  { name: 'parser-worker', needsPdfWorker: true },
];

export async function buildServers({ projectRoot = defaultProjectRoot } = {}) {
  const outputRoot = path.join(projectRoot, 'dist/servers');
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const { name, needsPdfWorker } of SERVERS) {
    const outputDirectory = path.join(outputRoot, name);
    await mkdir(outputDirectory, { recursive: true });

    if (needsPdfWorker) {
      const workerSource = path.join(
        projectRoot,
        'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      );
      try {
        await copyFile(workerSource, path.join(outputDirectory, 'pdf.worker.mjs'));
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          throw new Error(`pdf.worker.mjs is required for ${name}: ${workerSource}`);
        }
        throw error;
      }
    }

    await build({
      absWorkingDir: projectRoot,
      entryPoints: [`backend/server/entrypoints/${name}.ts`],
      outfile: path.join(outputDirectory, 'index.js'),
      bundle: true,
      format: 'cjs',
      logLevel: 'silent',
      platform: 'node',
      sourcemap: 'external',
      target: 'node22',
    });
  }

  return { serverNames: SERVERS.map(({ name }) => name), outputRoot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildServers()
    .then(({ serverNames, outputRoot }) => {
      console.log(`Built ${serverNames.length} server bundle(s) in ${outputRoot}`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Server build failed: ${message}`);
      process.exitCode = 1;
    });
}
```

Add to the `scripts` block of `package.json`, directly after `"build:lambdas"`:

```json
    "build:servers": "node scripts/build-servers.mjs",
```

- [ ] **Step 9: Run the build test to verify it passes**

Run: `pnpm test scripts/__tests__/build-servers.test.mjs`
Expected: PASS.

- [ ] **Step 10: Run the bundles**

```bash
pnpm build:servers
COGNITO_USER_POOL_ID=ap-southeast-1_local COGNITO_CLIENT_IDS=local PORT=18080 SHUTDOWN_DELAY_MS=0 node dist/servers/api/index.js &
sleep 2
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/healthz
curl -s http://127.0.0.1:18080/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/statements
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/aws/invoices
kill %1
node dist/servers/parser-worker/index.js; echo "exit=$?"
```

Expected output, in order: `200`, `{"status":"ok"}`, `401`, `404`, then a JSON log line containing `Missing required configuration: QUEUE_URL` and `exit=1`.

Then check the origin the way the v2 deployment will set it. `/health` is answered by the server and the `401` by a shared response builder, so both code paths are covered:

```bash
ALLOWED_ORIGIN=https://cashight-v2.nghuy.link COGNITO_USER_POOL_ID=ap-southeast-1_local COGNITO_CLIENT_IDS=local PORT=18081 SHUTDOWN_DELAY_MS=0 node dist/servers/api/index.js &
sleep 2
curl -s -D - -o /dev/null http://127.0.0.1:18081/health | grep -i '^access-control-allow-origin'
curl -s -D - -o /dev/null http://127.0.0.1:18081/statements | grep -i '^access-control-allow-origin'
curl -s -D - -o /dev/null -X OPTIONS http://127.0.0.1:18081/statements | grep -i '^access-control-allow-origin'
kill $!
ALLOWED_ORIGIN='*' COGNITO_USER_POOL_ID=ap-southeast-1_local COGNITO_CLIENT_IDS=local node dist/servers/api/index.js; echo "exit=$?"
```

Expected: three lines reading `Access-Control-Allow-Origin: https://cashight-v2.nghuy.link`, then an error containing `Invalid configuration: ALLOWED_ORIGIN` and `exit=1`.

- [ ] **Step 11: Full verification**

Run: `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build:lambdas`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add backend/server scripts/build-servers.mjs scripts/__tests__/build-servers.test.mjs backend/__tests__/server-start.test.ts package.json
git commit -m "feat(server): add container entrypoints and bundle build"
```

---

### Task 8: Use the shared route table in the local dev server

**Files:**
- Modify: `scripts/dev-server.ts` (the block from the `// POST /uploads` comment to just before the final `sendJson(response, 404, …)`, currently lines 325–428)

**Interfaces:**
- Consumes: `matchRoute` (Task 1)

This removes the second copy of the route table, so `pnpm dev:local` exercises the same routing the containers use.

- [ ] **Step 1: Add the import**

In `scripts/dev-server.ts`, after the line `import { localDataDir } from './local/paths';`, add:

```ts
import { matchRoute } from '../backend/server/routes';
```

- [ ] **Step 2: Replace the per-route blocks**

Delete everything from the comment `// POST /uploads` through the closing brace of the `// POST /summaries` block (the nine `if` blocks that call `handlers.*`). Put this in their place, directly after the `resolveClaims` try/catch:

```ts
  const match = matchRoute(method, url.pathname);
  if (match) {
    const body = match.readsBody ? (await readBody(request)).toString('utf8') : null;
    const event = buildEvent(request, url, match.pathParameters, body, claims);
    sendApiResponse(response, await handlers[match.handler](event));
    return;
  }
```

The final `sendJson(response, 404, …)` fallback stays as it is.

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: both pass. If `handlers[match.handler]` reports a missing key, the handler names in `scripts/local/handlers.ts` (`createLocalHandlers`' return object) have drifted from `HandlerName`; make `HandlerName` match them.

- [ ] **Step 4: Check the local stack end to end**

```bash
NEXT_PUBLIC_DEV_AUTH_BYPASS=true LOCAL_API_PORT=18787 pnpm dev:local &
sleep 4
for path in /health /statements /dashboard /session/capabilities /aws/invoices /aws/invoices/dashboard /aws/cost-explorer/reports /nope; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:18787$path")" "$path"
done
kill %1
```

Expected: `200` for every path except `/nope`, which is `404`. (`/dashboard` may return `200` with an empty view or `404` if the local data directory has no statements; either matches the behaviour on `main`. Compare against `main` if unsure.)

- [ ] **Step 5: Commit**

```bash
git add scripts/dev-server.ts
git commit -m "refactor(dev-server): route through the shared route table"
```

---

### Task 9: Image, CI job and runtime contract

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docs/container-runtime.md`
- Modify: `.github/workflows/ci.yaml` (add a job), `CLAUDE.md` (Commands table)

**Interfaces:**
- Consumes: `scripts/build-servers.mjs` and its `dist/servers/` layout (Task 7)
- Produces, for Plan 4:
  - One image. The container `args` select the workload: `/app/api/index.js`, `/app/aws-api/index.js`, `/app/parser-worker/index.js`, `/app/invoice-parser-worker/index.js`
  - API containers listen on `PORT` (default 8080); liveness `GET /healthz`, readiness `GET /readyz`
  - Runs as the distroless `nonroot` user (uid 65532) with no shell
  - The environment contract in `docs/container-runtime.md`

- [ ] **Step 1: Write `.dockerignore`**

The repository root holds real statements, an invoice PDF and `.env` files. None may enter a build context.

Create `.dockerignore`:

```gitignore
# Everything is excluded, then only what the build needs is allowed back in.
*
!package.json
!pnpm-lock.yaml
!pnpm-workspace.yaml
!tsconfig.json
!backend/
!packages/
!scripts/build-servers.mjs
**/node_modules
**/__tests__
**/*.pdf
**/.env*
```

- [ ] **Step 2: Write the `Dockerfile`**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY backend backend
COPY packages packages
COPY scripts/build-servers.mjs scripts/build-servers.mjs
RUN node scripts/build-servers.mjs

# Distroless: no shell, no package manager, runs as uid 65532.
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/dist/servers/ /app/
EXPOSE 8080
# The image entrypoint is node; the workload is chosen by overriding this argument.
CMD ["/app/api/index.js"]
```

- [ ] **Step 3: Build and inspect the image**

```bash
docker build -t cashight-backend:dev .
docker run --rm --entrypoint /nodejs/bin/node cashight-backend:dev -e "const fs=require('fs');for(const d of fs.readdirSync('/app'))console.log(d, fs.readdirSync('/app/'+d).join(' '))"
docker image inspect cashight-backend:dev --format '{{.Architecture}} {{.Config.User}} {{.Size}}'
```

Expected: four directories (`api`, `aws-api`, `invoice-parser-worker`, `parser-worker`), each with `index.js` and `index.js.map`, and `pdf.worker.mjs` in the two workers only. Architecture `arm64` on an Apple Silicon machine, user `nonroot` (or `65532`).

Confirm nothing sensitive was copied:

```bash
docker run --rm --entrypoint /nodejs/bin/node cashight-backend:dev -e "const fs=require('fs');const bad=[];(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())walk(p);else if(/\.pdf$|\.env/.test(e.name))bad.push(p)}})('/app');console.log(bad.length?bad:'clean')"
```

Expected: `clean`.

- [ ] **Step 4: Run the containers**

```bash
docker run -d --name cashight-api -p 18080:8080 \
  -e COGNITO_USER_POOL_ID=ap-southeast-1_local -e COGNITO_CLIENT_IDS=local \
  cashight-backend:dev
sleep 2
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/healthz
curl -s http://127.0.0.1:18080/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/statements
docker stop -t 15 cashight-api && docker inspect cashight-api --format 'exit={{.State.ExitCode}}' && docker rm cashight-api
docker run --rm cashight-backend:dev /app/parser-worker/index.js; echo "exit=$?"
```

Expected: `200`, `{"status":"ok"}`, `401`, `exit=0` (graceful stop inside the default 5 s drain), then a `Missing required configuration: QUEUE_URL` log line and `exit=1`.

- [ ] **Step 5: Add the CI job**

First make CI run for pull requests into `cashight-v2`. In `.github/workflows/ci.yaml`, change the trigger at the top of the file from

```yaml
on:
  pull_request:
    branches: [main]
```

to

```yaml
on:
  pull_request:
    branches: [main, cashight-v2]
```

GitHub evaluates this filter from the pull request's own copy of the workflow, so the change takes effect for the pull request that introduces it. Do not touch `application-deploy.yaml`: it must keep deploying only from `main`.

Then, in the same file, add this job after the `app` job, at the same indentation as `app:`:

```yaml
  container:
    name: Container image
    # Native arm64 runner: the platform nodes are Graviton.
    runs-on: ubuntu-24.04-arm

    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Build image
        run: docker build -t cashight-backend:ci .

      - name: API answers probes and enforces auth
        run: |
          docker run -d --name api -p 8080:8080 \
            -e COGNITO_USER_POOL_ID=ap-southeast-1_ci -e COGNITO_CLIENT_IDS=ci-client \
            cashight-backend:ci
          for attempt in $(seq 1 20); do
            curl -fsS http://127.0.0.1:8080/healthz && break
            sleep 1
          done
          curl -fsS http://127.0.0.1:8080/health | grep -q '"status":"ok"'
          test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/statements)" = 401
          test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/aws/invoices)" = 404
          docker logs api
          docker rm -f api

      - name: AWS API serves only its own routes, on a configured origin
        run: |
          docker run -d --name aws-api -p 8081:8080 \
            -e COGNITO_USER_POOL_ID=ap-southeast-1_ci -e COGNITO_CLIENT_IDS=ci-client \
            -e ALLOWED_ORIGIN=https://cashight-v2.nghuy.link \
            cashight-backend:ci /app/aws-api/index.js
          for attempt in $(seq 1 20); do
            curl -fsS http://127.0.0.1:8081/healthz && break
            sleep 1
          done
          test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/aws/invoices)" = 401
          test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/statements)" = 404
          # /health is answered by the server, the 401 by a shared response
          # builder, and OPTIONS by the preflight branch: three code paths.
          expected='^access-control-allow-origin: https://cashight-v2.nghuy.link'
          curl -s -D - -o /dev/null http://127.0.0.1:8081/health | grep -qi "$expected"
          curl -s -D - -o /dev/null http://127.0.0.1:8081/aws/invoices | grep -qi "$expected"
          curl -s -D - -o /dev/null -X OPTIONS http://127.0.0.1:8081/aws/invoices | grep -qi "$expected"
          docker rm -f aws-api

      - name: API keeps the production origin by default and refuses a widened one
        run: |
          docker run -d --name api-default -p 8082:8080 \
            -e COGNITO_USER_POOL_ID=ap-southeast-1_ci -e COGNITO_CLIENT_IDS=ci-client \
            cashight-backend:ci
          for attempt in $(seq 1 20); do
            curl -fsS http://127.0.0.1:8082/healthz && break
            sleep 1
          done
          curl -s -D - -o /dev/null http://127.0.0.1:8082/statements \
            | grep -qi '^access-control-allow-origin: https://cashight.nghuy.link'
          docker rm -f api-default
          status=0
          timeout 20 docker run --rm \
            -e COGNITO_USER_POOL_ID=ap-southeast-1_ci -e COGNITO_CLIENT_IDS=ci-client \
            -e ALLOWED_ORIGIN='*' cashight-backend:ci || status=$?
          # 1 = refused to start. 124 would mean it started and was still serving.
          test "$status" = 1

      - name: Workers refuse to start without configuration
        run: |
          for worker in parser-worker invoice-parser-worker; do
            if docker run --rm cashight-backend:ci "/app/${worker}/index.js"; then
              echo "${worker} started without QUEUE_URL" >&2
              exit 1
            fi
          done
```

If the repository's plan does not include the `ubuntu-24.04-arm` runner, the job stays queued. In that case use `runs-on: ubuntu-latest` and replace the build step with:

```yaml
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
      - name: Build image
        run: docker build --platform linux/arm64 -t cashight-backend:ci .
```

- [ ] **Step 6: Write the runtime contract**

Create `docs/container-runtime.md`:

```markdown
# Container runtime

The backend handlers in `backend/functions/` run either as Lambdas or as
containers. `pnpm build:servers` bundles four container entrypoints into
`dist/servers/`, and the root `Dockerfile` packages them into one image.

## Workloads

| Workload | Container args | Serves |
|---|---|---|
| `cashight-api` | `/app/api/index.js` (default) | `/uploads`, `/statements`, `/dashboard`, `/session/capabilities`, `/summaries` |
| `cashight-aws-api` | `/app/aws-api/index.js` | `/aws/cost-explorer/*`, `/aws/invoices/*` |
| `cashight-parser-worker` | `/app/parser-worker/index.js` | the statement parse queue |
| `cashight-invoice-parser-worker` | `/app/invoice-parser-worker/index.js` | the invoice parse queue |

An ingress must send `/aws/*` to `cashight-aws-api` and everything else to
`cashight-api`. Each API answers 404 for the other's routes.

## Probes (API workloads)

| Path | Use |
|---|---|
| `GET /healthz` | Liveness. Always 200 while the process runs. |
| `GET /readyz` | Readiness. 503 from SIGTERM until exit. |
| `GET /health` | Public health check, same body the API Gateway mock returned. |

Workers expose no port. A worker that cannot make progress exits and is restarted.

## Environment

### All workloads

| Variable | Required | Notes |
|---|---|---|
| `STORAGE_REGION` or `AWS_REGION` | no | Defaults to `ap-southeast-1` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | OTLP/HTTP base URL, e.g. `http://otel-gateway.observability:4318`. Unset disables export. |
| `APP_VERSION` | no | Reported as `service.version`; set it to the image digest or commit SHA |
| `ENABLE_LEGACY_WORKSPACE_FALLBACK`, `ENABLE_LEGACY_AUTHZ_FALLBACK` | no | Same meaning as on the Lambdas |

### API workloads

| Variable | Required | Notes |
|---|---|---|
| `COGNITO_USER_POOL_ID` | yes | `terraform output` user pool id |
| `COGNITO_CLIENT_IDS` | yes | Comma-separated app client ids allowed to call the API (SPA client, smoke client) |
| `ALLOWED_ORIGIN` | no | The single browser origin allowed by CORS. Default `https://cashight.nghuy.link`. Must be one https origin with no path, trailing slash, port 443, wildcard or list; anything else stops the process at startup. See "Hostnames and rollout". |
| `PORT` | no | Default `8080` |
| `RATE_LIMIT_BURST`, `RATE_LIMIT_PER_SECOND` | no | Defaults `50` and `100`, per pod |
| `SHUTDOWN_DELAY_MS` | no | Default `5000`. Drain time after readiness fails. |

| Workload | Also requires |
|---|---|
| `cashight-api` | `TABLE_NAME`, `STATEMENTS_BUCKET`, `UPLOAD_BUCKET`, `GEMINI_PARAM` |
| `cashight-aws-api` | `TABLE_NAME`, `STATEMENTS_BUCKET`, `UPLOAD_BUCKET`, `EXPORT_BUCKET`, `GEMINI_PARAM`; optional `GRANULAR_DATA_ENABLED` |

### Worker workloads

| Variable | Required | Notes |
|---|---|---|
| `QUEUE_URL` | yes | The queue this worker consumes |
| `MAX_PROCESSING_SECONDS` | yes | Per-job limit; must be below the 360 s visibility timeout. `120` for the statement parser, `300` for the invoice parser. |
| `TABLE_NAME`, `STATEMENTS_BUCKET`, `UPLOAD_BUCKET` | yes | |
| `PDF_PASSWORD_PARAM` | statement parser only | SSM parameter name |

Set the pod's `terminationGracePeriodSeconds` above `MAX_PROCESSING_SECONDS` for
workers, and above `SHUTDOWN_DELAY_MS` for APIs, so a rollout never cuts off
work in progress.

AWS credentials come from the SDK default chain (EKS Pod Identity in the
cluster). Secrets are read from SSM at runtime; no secret is passed by
environment variable.

## Hostnames and rollout

The container stack is rolled out beside the Lambda stack on its own hostname,
then takes over the production name once the Lambda stack is retired. No
hostname is compiled into the image except the default origin, so each stage
is a configuration change.

| Stage | Frontend origin | API hostname | `ALLOWED_ORIGIN` on both API workloads |
|---|---|---|---|
| Parallel run and soak | `https://cashight-v2.nghuy.link` | `api.cashight-v2.nghuy.link` | `https://cashight-v2.nghuy.link` |
| After the rename | `https://cashight.nghuy.link` | `api.cashight.nghuy.link` | unset, or `https://cashight.nghuy.link` |

Each deployment allows exactly one origin (SEC-006). The Lambdas never set
`ALLOWED_ORIGIN` and keep answering for `https://cashight.nghuy.link`.

At the rename, the frontend build (`NEXT_PUBLIC_API_BASE_URL`,
`NEXT_PUBLIC_APP_ORIGIN`), the DNS records and `ALLOWED_ORIGIN` must change
together: a browser on one origin calling an API that allows the other gets a
CORS failure on every request. The same Cognito user pool serves both stages,
so `COGNITO_USER_POOL_ID` does not change; add the v2 app client id to
`COGNITO_CLIENT_IDS` only if the v2 frontend gets its own client.

## Telemetry

| Signal | Name | Attributes |
|---|---|---|
| Histogram | `http.server.request.duration` (s) | `http.request.method`, `http.route`, `http.response.status_code` |
| Counter | `cashight.worker.jobs` | `outcome` = `succeeded` \| `failed` \| `timed_out` |
| Histogram | `cashight.worker.job.duration` (s) | `outcome` |
| Counter | `cashight.aws_invoice_parse_failure` | `error_code` |
| Counter | `cashight.legacy_workspace_fallback`, `cashight.legacy_authz_fallback` | — |
| Span | `<METHOD> <route>`, `worker.job` | same attributes as the matching metric |

`http.route` is the handler name (`dashboard`, `statements`, …), never the URL.
Logs are JSON lines on stdout with `trace_id` and `span_id` when a span is
active. Nothing above carries request bodies, query strings, tokens or
statement content; keep it that way when adding attributes.

## Local use

    pnpm build:servers
    docker build -t cashight-backend:dev .
    docker run --rm -p 8080:8080 \
      -e COGNITO_USER_POOL_ID=<pool id> -e COGNITO_CLIENT_IDS=<client id> \
      cashight-backend:dev
```

- [ ] **Step 7: Confirm the per-workload variables against the code**

Run: `grep -rnoE "requiredEnvironmentValue\('[A-Z_]+'\)|process\.env\.[A-Z_]+" backend/functions backend/shared | awk -F: '{split($1,p,"/"); print p[3]" "$3}' | sort -u`
Expected: every variable printed for a function appears in the table for the workload that hosts it (`uploads-api`, `upload-status-api`, `statements-api`, `dashboard-api`, `summary-api`, `session-capabilities-api` → `cashight-api`; `cost-explorer-api`, `aws-invoices-api`, `aws-invoice-summary-api` → `cashight-aws-api`). Add any that are missing to `docs/container-runtime.md`. `auth-guard` stays a Lambda and is ignored here.

- [ ] **Step 8: Add the command to `CLAUDE.md`**

In the Commands table of `CLAUDE.md`, add this row after the `Production build` row:

```markdown
| Bundle the container entrypoints | `pnpm build:servers` — see [`docs/container-runtime.md`](./docs/container-runtime.md) |
```

- [ ] **Step 9: Full verification**

Run: `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build:lambdas && pnpm build:servers`
Expected: all pass.

- [ ] **Step 10: Commit and open the pull request**

```bash
git add Dockerfile .dockerignore docs/container-runtime.md .github/workflows/ci.yaml CLAUDE.md
git commit -m "feat(server): package the backend as a container image"
git push -u origin feat/container-runtime
gh pr create --base cashight-v2 --title "feat: backend container runtime (EKS migration, plan 1 of 5)" --body "Adds an HTTP server, an SQS consumer and a container image around the existing Lambda handlers. The CORS origin becomes per-deployment configuration (ALLOWED_ORIGIN, default unchanged) so the new stack can run at cashight-v2.nghuy.link beside the current one. No infrastructure, DNS or Lambda configuration changes. Targets cashight-v2, so merging deploys nothing. Spec: docs/superpowers/specs/2026-10-08-eks-migration-design.md"
```

Verify the target: `gh pr view --json baseRefName --jq .baseRefName`
Expected: `cashight-v2`. If it prints `main`, fix it with `gh pr edit --base cashight-v2` before anything is merged; a merge into `main` would redeploy the Lambdas.

Expected: the `CI` workflow runs both the `app` and `container` jobs and both pass. Merging this pull request into `cashight-v2` starts no deploy: `gh run list --workflow application-deploy.yaml --limit 1` shows no new run. The current architecture keeps running the code on `main`.

Because the Lambdas are not redeployed, their compatibility with the two shared-module edits is proven by tests and the build only: the unchanged `API error responses` test in `backend/__tests__/shared.test.ts`, the full suite, and `pnpm build:lambdas`. The first real deploy of that code happens whenever `cashight-v2` reaches `main` (Plan 5).

---

## Done when

- `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build:lambdas` and `pnpm build:servers` all pass.
- The CI `container` job is green.
- The pull request is merged into `cashight-v2`, `main` is unchanged (`git log origin/main -1` shows the same commit as before the plan started), and no `Application Deploy` run was triggered.
- A container started with `ALLOWED_ORIGIN=https://cashight-v2.nghuy.link` returns that origin on `/health`, on a 401 and on a preflight; one started with `ALLOWED_ORIGIN='*'` exits 1.
- `git grep -n 'cashight-v2\.nghuy\.link' -- backend scripts packages ':!*__tests__*'` prints nothing: the v2 hostname lives only in tests, docs and CI.
- `docs/container-runtime.md` matches the variables the code reads.
