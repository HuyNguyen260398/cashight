# Codebase Concerns

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| High | Amplify SSR/parse path is fragile — depends on hand-written DOM polyfill + post-build worker copy for pdfjs | `lib/pdf-dom-polyfill.ts`, `scripts/copy-pdf-worker.mjs`, 9 recent commits on `app/api/parse/route.ts` (scan HIGH-CHURN) | A pdfjs/Next upgrade can reintroduce opaque 500s on upload | Pin pdfjs/pdf-parse; add a deploy smoke test for `/api/parse` |
| Medium | Unpaginated S3 LIST caps at 1000 statements | `lib/storage.ts:125` | Silent data truncation beyond 1000 objects | Add pagination if scale ever grows (currently fine at ~12-36/yr) |
| Medium | `getAllStatements()` re-fetches every statement on each dashboard render (`force-dynamic`, no cache) | `lib/storage.ts:146-149`, `app/page.tsx:12` | Latency/cost grow linearly with statement count | Add caching or per-period prefix fetch |
| Medium | Auth gate is server-side only because Amplify never runs the Next 16 proxy middleware | `lib/require-session.ts:5-14`, `proxy.ts` | A route missing `requireSession()`/`requireApiSession()` is unprotected | Lint/check that every page+route calls a guard |
| Low | Region must agree across S3, Amplify, env vars or S3 GETs fail silently | `lib/storage.ts:57-59`, `CLAUDE.md` | Hard-to-diagnose prod failures | Keep `ap-southeast-1` invariant documented; assert at startup |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| README describes "implementation plan", not the shipped app | README predates the build; app is fully implemented | `README.md:7-8`, scan tree (real `app/`,`lib/`) | Onboarding confusion; wrong version claims | Update README to reflect the built app and Next 16 |
| README/CLAUDE say "Next.js 15"; actual is Next 16.2.6 / React 19 | Stack moved past the plan | `README.md:43`, `CLAUDE.md`, `package.json:22,28` | Misleading stack docs | Correct version references |
| Plan files (`docs/plans/00-19`) referenced from repo root in CLAUDE.md/README but live in `docs/plans/` | Files were relocated | `CLAUDE.md`, `README.md:8`, scan tree 79-99 | Broken links | Fix paths |
| No coverage measurement | Never configured | `vitest.config.ts` | Unknown regression exposure | Add `@vitest/coverage` + threshold |
| Legacy/migration artifacts committed in `terraform/` | One-off migrations | `terraform/terraform.tfstate.backup-before-cashight-tfstate-migration` | Repo clutter; stale state confusion | Archive/remove after confirming migration |

### 3) Security Concerns

| Risk | OWASP category | Evidence | Current mitigation | Gap |
|------|----------------|----------|--------------------|-----|
| PAN / PII leakage | A02 (Crypto/Data exposure) | `lib/parsers/tpbank.ts:230-236`, `lib/summary-payload.ts` | PAN masked at parser boundary; only anonymized aggregates sent to Gemini; logs are boolean/last4 only | Relies on discipline — no automated check that logs/payloads stay PII-free |
| Broken access control | A01 | `lib/require-session.ts`, `proxy.ts` | Single-email allowlist, fail-closed (`session.user` required), `trustHost`; every route calls a guard | Enforcement is manual per route; proxy not deployed on Amplify |
| Authn weaknesses | A07 | `lib/auth-allowlist.ts:17-31` | Strict `email_verified` check, exact email match, `prompt=select_account` | Single allowed email is a single point of access |
| Untrusted input (PDF/key) | A03 | `app/api/parse/route.ts:81-87`, `statements/[id]/route.ts:18` | MIME + 5MB size checks; storage keys must start with `statements/` | PDF parser surface trusts file content; relies on pdfjs robustness |
| Secrets management | A05 | `.env.example`, `amplify.yml:15` | Secrets via env/Amplify Console, gitignored; none in source | Rotation cadence undocumented |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|--------------|-----------------------|
| Full-fetch on every render | `lib/storage.ts:146-149`, `app/page.tsx:12` | N parallel S3 GETs per page load | Linear cost/latency growth | Cache or fetch only the active period prefix |
| Unbounded LIST | `lib/storage.ts:118-139` | none yet | Truncation >1000 keys | Paginate |
| Cold-start of pdfjs parse on Lambda | `instrumentation.ts`, `lib/pdf-dom-polyfill.ts` | First upload slower | Acceptable at personal scale | Monitor `maxDuration=30` headroom |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `app/api/parse/route.ts` | pdfjs/Amplify runtime quirks, error mapping | 9 changes / 90 days (top of scan) | Change behind the parser/storage interfaces; verify with fixture + deploy smoke test |
| `lib/storage.ts` | Region/auth/env coupling | 6 changes | Keep env resolution + auth classification centralized; add tests |
| `app/page.tsx` / `dashboard.tsx` | Render flow, redirect-outside-try-catch subtlety | 8 / 6 changes | Preserve `redirect` outside the storage try/catch (`page.tsx:43-50`) |
| `auth.ts` + `terraform/amplify.tf`/`iam.tf` | Auth + IAM + deploy interplay | 5 changes each | Change auth and infra together; test the allowlist in isolation |

### 6) `[ASK USER]` Questions

1. [ASK USER] Should the README and CLAUDE.md be updated now to reflect the shipped app (Next 16, auth, dark mode, password-protected PDFs) and the relocated `docs/plans/` paths — or are those intentionally kept as the historical build spec?
2. [ASK USER] Is there a target scale beyond personal use (which would justify S3 LIST pagination and dashboard caching), or is the ≤1000-statement assumption permanent?
3. [ASK USER] What is the intended secret-rotation policy for `AUTH_SECRET`, `GEMINI_API_KEY`, and Cognito/Google client secrets?
4. [ASK USER] Can the `terraform/terraform.tfstate.backup-before-cashight-tfstate-migration` and other migration artifacts be removed from version control?

### 7) Evidence

- scan output: HIGH-CHURN FILES, DIRECTORY TREE, TODO/SECURITY sections (`docs/codebase/.codebase-scan.txt`)
- `lib/storage.ts`, `lib/parsers/tpbank.ts`, `lib/pdf-dom-polyfill.ts`, `lib/require-session.ts`, `lib/auth-allowlist.ts`
- `README.md`, `CLAUDE.md`, `package.json`, `terraform/`
