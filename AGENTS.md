# Repository Guidelines

## Project Structure & Module Organization

Cashight is a Next.js App Router project. Route pages, layouts, API handlers, and app-local components live in `app/`; shared UI primitives live in `components/ui/`. Core business logic belongs in `lib/`, including parsers in `lib/parsers/`, storage, aggregation, formatting, auth helpers, and Zod schemas. Unit tests are in `lib/__tests__/` with `*.test.ts` names. Static assets are in `public/`, infrastructure is in `terraform/`, scripts are in `scripts/`, and implementation notes are under `docs/plans/`.

## Build, Test, and Development Commands

- `pnpm dev`: start the local Next.js dev server.
- `pnpm build`: create a production build.
- `pnpm start`: run the production build locally after `pnpm build`.
- `pnpm lint`: run ESLint with Next.js core web vitals and TypeScript rules.
- `pnpm test`: run the Vitest suite once.
- `pnpm test:watch`: run Vitest in watch mode.
- `cd terraform && terraform plan`: review infrastructure changes before applying.

## Coding Style & Naming Conventions

Use TypeScript throughout. Prefer small, pure helpers in `lib/` for parsing, aggregation, formatting, and validation; keep route handlers thin. Use the `@/` alias for repository-root imports. Follow existing formatting: two-space indentation, semicolons in app code, and descriptive camelCase function names. Match component filename style to the surrounding directory. Validate external data at boundaries with Zod schemas from `lib/schemas.ts`.

## Testing Guidelines

Vitest runs in a Node environment. Put focused unit tests in `lib/__tests__/` with names like `storage.test.ts` or `aggregations.test.ts`. Prefer deterministic tests around parser output, period math, categorization, storage, and auth allowlist logic. Run `pnpm test` before submitting changes; run `pnpm lint` for UI, route, or TypeScript changes.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style messages such as `feat: add Cognito login provider` and `docs: add Cognito env vars`. Keep commits scoped and imperative. Pull requests should include a short summary, test results, linked issue or plan step when applicable, and screenshots for visible UI changes. For auth, storage, parser, or Terraform changes, call out configuration and migration implications explicitly.

## Security & Configuration Tips

Copy `.env.example` to `.env.local` for local development and never commit secrets. Required services include Gemini and AWS S3; AWS resources target `ap-southeast-1`. Preserve the privacy boundary: raw card numbers and transaction-level PII must not be sent to AI summary code.
