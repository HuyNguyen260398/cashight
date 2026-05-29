# Step 01 — Project Setup & Data Schemas

> Scaffold the Next.js project, install dependencies, configure tooling, and define the Zod data model.

**Estimated effort:** 1–2 hours
**Prerequisites:** None
**Phase:** 1 — MVP

---

## Goal

A fresh Next.js 15 project running locally on `pnpm dev` with Tailwind, shadcn/ui, and the full data schema defined. No business logic yet — just the foundation.

## Tasks

1. **Scaffold the Next.js project:**
   ```bash
   pnpm create next-app@latest expense-tracker \
     --typescript --tailwind --app --no-src-dir --eslint
   cd expense-tracker
   ```

2. **Install all runtime dependencies:**
   ```bash
   pnpm add pdf-parse zod react-dropzone recharts \
     @google/genai @aws-sdk/client-s3 date-fns
   pnpm add -D @types/pdf-parse
   ```

3. **Initialize shadcn/ui:**
   ```bash
   pnpm dlx shadcn@latest init
   # Choose: Default style, Slate base color, CSS variables yes
   ```

4. **Add the shadcn components needed for Phase 1:**
   ```bash
   pnpm dlx shadcn@latest add button card tabs table badge skeleton sonner
   ```

5. **Create the folder structure:**
   ```bash
   mkdir -p app/api/parse app/api/summarize app/upload
   mkdir -p app/components lib/parsers
   ```

6. **Define Zod schemas in `lib/schemas.ts`** — copy from the master plan §6:
   - `TransactionSchema`
   - `StatementSchema`
   - Export inferred TypeScript types

7. **Add a `.env.local` template** (`.env.example`):
   ```
   GEMINI_API_KEY=
   STATEMENTS_BUCKET=
   AWS_REGION=ap-southeast-1
   ```

8. **Add `.gitignore` entries:**
   ```
   .env.local
   .env*.local
   /test-pdfs/
   ```

9. **Create a test PDFs directory** for local validation (gitignored):
   ```bash
   mkdir test-pdfs
   # Copy the sample TPBank PDF here
   ```

10. **Initialize git and make first commit.**

## Files affected

- `package.json` — dependencies
- `tailwind.config.ts` — auto-generated
- `components.json` — shadcn config
- `lib/schemas.ts` — **create** (data model)
- `.env.example` — **create**
- `.gitignore` — modify

## Acceptance criteria

- `pnpm dev` starts on `http://localhost:3000` showing default Next.js page
- `pnpm build` completes without errors
- `lib/schemas.ts` exports `StatementSchema`, `TransactionSchema`, and inferred types
- TypeScript compiles cleanly (`pnpm tsc --noEmit`)

## Notes & gotchas

- Use `--no-src-dir` to match the folder structure in the master plan (root-level `app/` and `lib/`).
- shadcn/ui will modify `tailwind.config.ts` and `globals.css` — let it.
- Don't add `@aws-sdk/client-dynamodb` — we're using S3 for storage (see master plan §3.3).
- Pin pnpm version via `packageManager` field in `package.json` so it's consistent on Amplify:
  ```json
  "packageManager": "pnpm@9.x.x"
  ```

## Next step

[Step 02 — TPBank PDF parser & categorization](./02-pdf-parser-and-categorization.md)
