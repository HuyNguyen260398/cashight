# Technology Stack

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | TypeScript (strict) | `tsconfig.json`, 40 `.ts` + 32 `.tsx` files (scan CODE METRICS) |
| Runtime + version | Node.js (Next.js server routes pin `runtime = 'nodejs'`); CI/Amplify run Node 24 | `app/api/parse/route.ts:1`, `.github/workflows/ci.yaml` (`node-version: 24`) |
| Package manager | pnpm 11.2.2 (pinned via `packageManager`) | `package.json:50` |
| Module/build system | Next.js 16 App Router; ESM (`"module": "esnext"`, `moduleResolution: bundler`) | `next.config.ts`, `tsconfig.json:10-11` |

### 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| `next` | 16.2.6 | App Router framework, SSR + API routes | `package.json:22` |
| `react` / `react-dom` | 19.2.4 | UI rendering (server + client components) | `package.json:28-29` |
| `next-auth` | 5.0.0-beta.31 | Single-user auth (Google + Cognito providers) | `package.json:23`, `auth.ts` |
| `pdf-parse` | 2.4.5 | PDF text extraction (Node-only) | `package.json:25`, `lib/parsers/tpbank.ts:17` |
| `pdfjs-dist` | 5.4.296 | Engine under pdf-parse; needs DOM polyfill on Lambda | `package.json:26`, `lib/pdf-dom-polyfill.ts` |
| `@aws-sdk/client-s3` | ^3.1055.0 | Statement persistence to S3 | `package.json:16`, `lib/storage.ts` |
| `@google/genai` | ^2.6.0 | Gemini 2.5 Flash streaming summaries | `package.json:17`, `lib/gemini.ts` |
| `zod` | ^4.4.3 | Boundary validation of parser output and S3 reads | `package.json:35`, `lib/schemas.ts` |
| `recharts` | ^3.8.1 | Dashboard charts (pie, bar, trend, area) | `package.json:31`, `app/components/*-chart.tsx` |
| `radix-ui` | ^1.4.3 | Headless UI primitives behind shadcn/ui components | `package.json:27`, `components/ui/` |
| `react-dropzone` | ^15.0.0 | Upload drag-and-drop | `package.json:30`, `app/components/upload-dropzone.tsx` |
| `date-fns` | ^4.3.0 | Date math (`getDaysInMonth`) in aggregations | `package.json:21`, `lib/aggregations.ts:9` |
| `next-themes` | ^0.4.6 | Dark-mode toggle | `package.json:24`, `app/components/theme-provider.tsx` |
| `sonner` | ^2.0.7 | Toast notifications | `package.json:32` |
| `lucide-react` / `clsx` / `tailwind-merge` / `class-variance-authority` / `tw-animate-css` | various | Icons + Tailwind class composition | `package.json` |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| `vitest` 4.1.7 | Unit test runner | `package.json:48`, `vitest.config.ts` |
| `eslint` 9 + `eslint-config-next` | Lint | `package.json:43-44`, `eslint.config.mjs` |
| `typescript` 5 | Type checking | `package.json:47`, `tsconfig.json` |
| `tailwindcss` 4 + `@tailwindcss/postcss` | Styling | `package.json:45-46`, `postcss.config.mjs` |
| `tsx` 4.22.3 | Run TS scripts (`scripts/*.ts`) | `package.json:46`, `scripts/test-parser.ts` |
| Terraform (~> 5.0 AWS provider, TF >= 1.10) | Provision S3, Cognito, Amplify, IAM | `terraform/main.tf` |

### 4) Key Commands

```bash
pnpm install --frozen-lockfile          # install
pnpm build                              # next build + copy pdfjs worker into bundle
pnpm test                              # vitest run (CI mode, not watch)
pnpm lint                              # eslint
pnpm tsc --noEmit                       # type check
pnpm tsx scripts/test-parser.ts         # run parser against local sample PDF
cd terraform && terraform apply         # provision AWS infra
```

### 5) Environment and Config

- Config sources: `.env.local` (dev, gitignored), Amplify Console + `.env.production` (prod, built by `amplify.yml:15`), `terraform/*.tfvars`.
- Required env vars: `STATEMENTS_BUCKET` (app crashes at first S3 call if unset — see `lib/storage.ts:43-52`), `GEMINI_API_KEY`, `STORAGE_REGION` / `AWS_REGION` (default `ap-southeast-1`), `PDF_PASSWORD` (optional, unlocks protected PDFs), `AUTH_SECRET`, `ALLOWED_EMAIL`, `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, `AUTH_COGNITO_ID` / `AUTH_COGNITO_SECRET` / `AUTH_COGNITO_ISSUER`. Evidence: `.env.example`.
- Deployment/runtime constraints: Amplify reserves the `AWS_*` env-var prefix, so prod uses `STORAGE_REGION` instead of `AWS_REGION` (`lib/storage.ts:57-59`). Amplify's WEB_COMPUTE platform does not forward build env vars to the SSR Lambda; `amplify.yml` greps them into `.env.production` so Next bundles them.

### 6) Evidence

- `package.json`, `pnpm-lock.yaml`
- `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `amplify.yml`
- `.env.example`, `.github/workflows/ci.yaml`
