# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary test framework: Vitest 4.1.7 (`package.json:48`), node environment (`vitest.config.ts:11`).
- Assertion/mocking tools: built-in Vitest `expect`; `describe`/`it`/`beforeAll`/`describe.skipIf`. No separate mocking library; tests use the real `fs` to read fixture PDFs.
- Commands:

```bash
pnpm test            # vitest run (single pass, CI mode)
pnpm test:watch      # vitest watch
pnpm test lib/__tests__/aggregations.test.ts   # single file
# no dedicated integration/e2e or coverage command configured
```

### 2) Test Layout

- Test file placement: co-located in `lib/__tests__/` (not alongside each source file).
- Naming convention: `<module>.test.ts`.
- Setup files: none configured in `vitest.config.ts`; path alias `@` resolved there (`vitest.config.ts:5-9`). Fixture-dependent suites read PDFs from `test-pdfs/` at runtime and self-skip when absent.

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | yes | `aggregations`, `period`, `format`, `categorize` (via tpbank), `auth-allowlist`, `upload-error`, `pdf-dom-polyfill`, `storage` | Pure functions; the correctness baseline per `CLAUDE.md` |
| Integration | partial | Parser against real fixture PDFs (`tpbank.test.ts`), `deployment-dependencies.test.ts` | Real PDF parse end-to-end through Zod; skipped in CI (fixtures gitignored) |
| E2E | no | — | No Playwright/Cypress; no browser-flow tests |

Suites present: `aggregations`, `auth`, `deployment-dependencies`, `format`, `pdf-dom-polyfill`, `period`, `storage`, `tpbank`, `upload-error` (9 files, `lib/__tests__/`).

### 4) Mocking and Isolation Strategy

- Main mocking approach: minimal — pure functions called directly with literal inputs; the parser is exercised against genuine fixture PDFs rather than mocked text.
- Isolation guarantees: tests are stateless (no shared mutable fixtures beyond a `beforeAll` parse); pure modules guarantee no cross-test leakage.
- Common failure mode: a missing gitignored fixture (`test-pdfs/...`) — handled by `describe.skipIf(!hasFixture)` and `existsSync` checks (`tpbank.test.ts:18-40`), so CI passes without the PDFs.

### 5) Coverage and Quality Signals

- Coverage tool + threshold: none configured — [TODO].
- Current reported coverage: [TODO] (not measured).
- Known gaps/flaky areas: API route handlers (`app/api/*`) and React components have no unit tests; coverage of the HTTP/error-mapping layer relies on manual/deploy verification. CI runs lint + build + test on PRs to `main` (`.github/workflows/ci.yaml`).

### 6) Evidence

- `vitest.config.ts`, `package.json` (scripts)
- `lib/__tests__/tpbank.test.ts` (fixture-skip pattern), `lib/__tests__/aggregations.test.ts`
- `.github/workflows/ci.yaml`
