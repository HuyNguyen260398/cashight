# Coding Conventions

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files | kebab-case modules/components; Next.js reserved names verbatim | `summary-payload.ts`, `ai-summary-card.tsx`, `route.ts` | scan tree, `app/components/` |
| Functions/methods | camelCase, verb-first | `parseTPBankStatement`, `buildSummaryPayload`, `getAllStatements` | `lib/parsers/tpbank.ts:218`, `lib/summary-payload.ts:43` |
| Types/interfaces | PascalCase; Zod schema `XSchema` + inferred type `X` | `Statement`/`StatementSchema`, `AggregatedView`, `PeriodSpec` | `lib/schemas.ts:30-39`, `lib/aggregations.ts:20` |
| Constants/env vars | UPPER_SNAKE for module consts and env vars | `NON_SPEND`, `SPECIAL_RULES`, `STATEMENTS_BUCKET`, `MARKER_SPEND_END` | `lib/dashboard-aggregations.ts:18`, `lib/categorize.ts:41` |

### 2) Formatting and Linting

- Formatter: no Prettier config committed; formatting is convention-driven (2-space indent, single quotes, trailing commas, semicolons throughout).
- Linter: ESLint 9 flat config extending `eslint-config-next` (`eslint.config.mjs`).
- Most relevant enforced rules: TypeScript `strict: true` (`tsconfig.json:7`); Next.js core-web-vitals ruleset; `noEmit` type checking.
- Run commands: `pnpm lint`, `pnpm tsc --noEmit`.

### 3) Import and Module Conventions

- Import grouping: external packages first, then `@/`-aliased internal modules (e.g. `app/page.tsx:1-10`). Auth-related files separate node/external from local with a blank line.
- Alias vs relative: prefer `@/...` absolute alias for cross-module imports; relative (`../parsers/tpbank`) appears inside `lib/__tests__/`.
- Public exports/barrel policy: no barrel `index.ts` files — modules export named symbols directly; types re-exported where needed (`export type { PeriodSpec }` in `lib/aggregations.ts:18`).

### 4) Error and Logging Conventions

- Error strategy by layer: pure `lib/` functions throw `Error` with descriptive prefixes (`TPBank parser: could not find ...`, `lib/parsers/tpbank.ts:89`). Route handlers catch and map to HTTP status codes (400/401/409/413/415/422/500/502/503) returning JSON, never letting errors escape as opaque 500s (`app/api/parse/route.ts:57-179`).
- Logging style: `console.info`/`console.error` with a bracketed request-id tag for greppability in CloudWatch — `[parse <reqId>] <stage>` (`app/api/parse/route.ts:21-24`). Errors serialized via `describeError()` (name/message/stack).
- Sensitive-data redaction: **strict PCI rule** — only non-sensitive values (cardLast4, counts, totals, storage keys) may be logged; never the full PAN, raw descriptions, names, the file, or a PDF password (logs only whether one was configured, `route.ts:106-109`). Env snapshots log booleans, never values (`route.ts:42-49`).

### 5) Testing Conventions

- Test file naming/location: co-located under `lib/__tests__/` as `<module>.test.ts` (`tpbank.test.ts`, `aggregations.test.ts`).
- Mocking strategy: minimal mocking; pure functions tested directly; parser tested against real gitignored fixture PDFs using `describe.skipIf(!hasFixture)` so CI (which lacks the fixtures) skips them (`lib/__tests__/tpbank.test.ts:40`).
- Coverage expectation: no coverage threshold configured (`vitest.config.ts` has none) — [TODO].

### 6) Evidence

- `eslint.config.mjs`, `tsconfig.json`
- `lib/parsers/tpbank.ts`, `app/api/parse/route.ts` (logging/redaction)
- `lib/__tests__/tpbank.test.ts`
