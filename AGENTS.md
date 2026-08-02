# Repository Guidelines

## Project Structure & Module Organization

Cashight is a shipped personal expense tracker built with Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Auth.js v5, Gemini, and S3. Application code lives at the repo root with no `src/` directory. Route pages, layouts, API handlers, and app-local components live in `app/`; shared shadcn/ui primitives live in `components/ui/`. Core business logic belongs in `lib/`, including parsers in `lib/parsers/`, storage, aggregation, formatting, auth helpers, period handling, Gemini payload shaping, PDF polyfills, and Zod schemas.

Unit tests live in `lib/__tests__/` with `*.test.ts` names. Static assets are in `public/`, infrastructure is in `terraform/`, operational scripts are in `scripts/`, CI/CD workflows are in `.github/workflows/`, deployment docs are in `docs/DEPLOYMENT.md`, current codebase docs are in `docs/codebase/`, and implementation-plan notes are under `docs/plans/`.

The numbered files in `docs/plans/` are the original incremental build spec. If a user asks to "start", "do step N", or "continue", use `docs/plans/00-INDEX.md` to confirm dependencies and treat the relevant `docs/plans/NN-*.md` file's Tasks, Files affected, and Acceptance criteria as the contract.

## Architecture & Runtime Constraints

The upload path is deterministic and multi-bank. `extractPdfText()` pulls text once, trying each candidate password from the PDF password secret; `detectBank()` identifies the issuer from marker strings; `parsers/index.ts` routes to `parsers/tpbank.ts` (regex over line text) or `parsers/vib.ts` (coordinate-based layout rows), or throws `UnsupportedBankError` → job `errorCode: 'UNSUPPORTED_BANK'`. Then `lib/categorize.ts` categorizes transactions, `StatementSchema.parse()` validates output, and `lib/storage.ts` saves to S3 at `statements/{cardLast4}/{year}/{year}-{mm}.json`. Re-uploading the same month overwrites that key; S3 versioning preserves earlier versions.

Bank knowledge — codes, short names, detection markers, `DEFAULT_BANK`, `?bank=` URL parsing — lives only in `packages/domain/src/banks.ts`. Adding a bank means adding a profile there plus a parser. The dashboard views exactly one bank at a time, never a combined total. `parseBankFromSearch()` returns null when `?bank=` is absent or unrecognised ("not chosen"); `aggregate()` then resolves it via `resolveBank()` against the banks actually present in the period and reports the choice as `selectedBank`, which is what the dropdown renders. Keep that resolution server-side — URL parsing cannot know which banks have data. An explicit `?bank=` is always honoured, even when that bank has no statements in the period.

VIB specifics: amounts are `5,591,567.00` (comma thousands, dot decimal — the inverse of TPBank), descriptions embed a masked PAN, the card-account number and the cardholder's name (stripped by `scrubVibDescription()` at the parser boundary), and the parser reconciles its per-row tally against the statement's own total-debit figure, throwing when they disagree.

The DOM polyfill import must precede any `pdfjs-dist` or `pdf-parse` import in the same module — pdfjs touches `DOMMatrix` at module-eval time, and getting this wrong crashes only in the bundled Lambda. `dist/lambdas/parser-worker/pdf.worker.mjs` must ship beside `index.js`; `scripts/build-lambdas.mjs` copies it.

Dashboard data is server-rendered from S3: `getAllStatements()` lists and loads statements, pure aggregation helpers roll up month/quarter/year views, and the period state lives in the URL (`?period=quarter&year=2026&quarter=2`). Keep `app/page.tsx` and data-reading API routes dynamic because S3 content can change between requests.

AI summaries must use anonymized aggregates only. `/api/summarize` may receive a `Statement` or `AggregatedView`, but `buildSummaryPayload()` must strip data to totals, top categories, and top merchants before constructing a Gemini prompt. Never send raw transaction descriptions, card numbers, names, or transaction-level PII to Gemini.

Any route importing `pdf-parse` must export `runtime = 'nodejs'`; Edge runtime breaks PDF parsing. The Amplify environment also needs the pdfjs worker and DOM polyfill support already present in `scripts/copy-pdf-worker.mjs` and `lib/pdf-dom-polyfill.ts`, so preserve those paths when touching parser or build behavior.

## Build, Test, and Development Commands

- `pnpm dev`: start the local Next.js dev server with the configured Node warning suppression.
- `pnpm build`: create a production build and copy the pdfjs worker into the bundle.
- `pnpm start`: run the production build locally after `pnpm build`.
- `pnpm tsc --noEmit`: run a TypeScript type check.
- `pnpm lint`: run ESLint 9 with Next.js rules.
- `pnpm test`: run the Vitest suite once.
- `pnpm test:watch`: run Vitest in watch mode.
- `pnpm test lib/__tests__/aggregations.test.ts`: run a single Vitest file.
- `pnpm tsx scripts/test-parser.ts`: test the TPBank parser against the local sample PDF.
- `pnpm cleanup:legacy-buckets:dry-run`: preview legacy S3 bucket cleanup.
- `pnpm cleanup:legacy-buckets`: delete legacy S3 buckets after explicit confirmation.
- `cd terraform && terraform init`: initialize Terraform.
- `cd terraform && terraform plan`: review infrastructure changes before applying.
- `cd terraform && terraform apply`: apply infrastructure changes.

`pnpm` is pinned to `11.2.2` via `packageManager` in `package.json`; keep Amplify and local usage aligned with that pin.

## Coding Style & Naming Conventions

Use TypeScript throughout. Prefer small, pure helpers in `lib/` for parsing, aggregation, formatting, validation, period math, and privacy-preserving payload shaping; keep route handlers thin and focused on HTTP, auth, validation, and error mapping. Use the `@/` alias for repository-root imports, except local relative imports inside nearby tests are fine.

Follow existing formatting: two-space indentation, single quotes, trailing commas, semicolons, descriptive camelCase functions, PascalCase types/components, and kebab-case filenames such as `summary-payload.ts` or `ai-summary-card.tsx`. Match component filename style to the surrounding directory. Do not introduce barrel files unless the local pattern changes.

Validate external data at boundaries with Zod schemas from `lib/schemas.ts`. Treat parser output and S3 JSON as trustworthy only after `StatementSchema.parse()`.

## Testing Guidelines

Vitest runs in a Node environment. Put focused unit tests in `lib/__tests__/` with names like `storage.test.ts` or `aggregations.test.ts`. Prefer deterministic tests around parser output, period math, categorization, storage, formatting, upload error mapping, PDF DOM polyfills, and auth allowlist logic.

Parser tests may depend on gitignored fixture PDFs in `test-pdfs/`; use the existing self-skip pattern when fixtures are absent so CI remains green. The canonical local fixtures are `test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf` (TPBank) and `test-pdfs/vib_saoke_07_2026_4550.pdf` (VIB, password-protected), with expected values documented in `CLAUDE.md`. Parser logic that does not need a PDF — layout row grouping, amount and date parsing, description scrubbing, bank detection — belongs in fixture-free tests so it runs in CI.

Run `pnpm test` for logic changes, `pnpm lint` for UI/route/TypeScript changes, and `pnpm tsc --noEmit` when changing shared types or schemas. CI on pull requests runs lint, build, and tests on Node 24.

## Security & Configuration

Copy `.env.example` to `.env.local` for local development and never commit secrets. Required services include Gemini and AWS S3; auth uses Google and/or AWS Cognito through Auth.js v5, gated by one `ALLOWED_EMAIL`. AWS resources target `ap-southeast-1`. Production uses `STORAGE_REGION` because Amplify reserves the `AWS_*` prefix; local development may use `AWS_REGION`. The app intentionally fails on the first S3 call if `STATEMENTS_BUCKET` is unset.

Preserve PCI hygiene. Mask the card number to `cardLast4` immediately after PDF extraction. The full PAN must never appear in logs, API responses, storage keys, persisted JSON, test output, or AI payloads. Logs may include booleans, counts, totals, storage keys, and `cardLast4`; they must not include raw transaction descriptions, names, full card numbers, file contents, secrets, or `PDF_PASSWORD`.

Vietnamese number formatting differs per bank: TPBank uses `.` as the thousands separator (`17.184.741`), VIB uses `,` with a `.` decimal (`5,591,567.00`). Each conversion lives only in that bank's parser module — `parsers/tpbank.ts` and `parsers/vib-fields.ts`. Do not spread that logic elsewhere.

The PDF password secret may hold either a plain string (one password) or a JSON map of candidates, `{"TPB":"…","VIB":"…"}`. The keys are labels only: the bank cannot be known before the PDF is decrypted, so every value is tried in turn. Never log the secret, the parsed list, or any element of it.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style messages such as `docs: update CLAUDE.md to match the shipped app`, `fix: ship pdfjs worker into the bundle so parsing works on Amplify (upload 422)`, and `feat: add Cognito login provider`. Keep commits scoped and imperative. Pull requests should include a short summary, test results, linked issue or plan step when applicable, and screenshots for visible UI changes. For auth, storage, parser, PDF bundling, Amplify, or Terraform changes, call out configuration, privacy, runtime, and migration implications explicitly.
