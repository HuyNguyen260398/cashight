# Step 16 — Handle Password-Protected PDF Statements

> Older TPBank statements are password-protected. The upload flow must decrypt them automatically using a **server-only** password, with no change to the user's drag-and-drop experience.

**Estimated effort:** 45–60 minutes
**Prerequisites:** Step 03 (parser + `/api/parse`)
**Phase:** 4 — Pre-deployment feature pass

---

## Goal

Uploading a password-protected statement PDF succeeds transparently. Unprotected PDFs continue to work. The password lives only in a server-side environment variable and never appears in any response, log line, or payload sent to Gemini/S3.

## Background

`pdf-parse` v2 wraps pdf.js and supports decryption natively:
- `new PDFParse({ data, password })` — `password` is part of `LoadParameters` (`DocumentInitParameters`).
- It throws `PasswordException` when a password is required or wrong.

## Tasks

### 1. Parser accepts an optional password — `lib/parsers/tpbank.ts`

- Change the signature to `parseTPBankStatement(buffer: Buffer, password?: string)`.
- **Strategy — try unprotected first, then retry with the password:**
  1. Attempt `getText()` with **no** password.
  2. If it throws a `PasswordException` (import the class from `pdf-parse`, or detect by `err?.name === 'PasswordException'`), construct a new `PDFParse` with `{ data, password }` and retry once.
  3. Any other error, or a still-failing retry, propagates as today.
- Keep the existing `try/finally { await parser.destroy() }` discipline for **both** attempts (each `PDFParse` instance must be destroyed).
- **PCI/secret hygiene:** do **not** log the password or the raw `PasswordException` (its message can echo input). The existing PAN-masking guarantees are unchanged.

### 2. Route passes the env-var password — `app/api/parse/route.ts`

- Read `const password = process.env.PDF_PASSWORD;` (may be `undefined`).
- Call `parseTPBankStatement(buffer, password)`.
- The existing `catch` already returns a generic `422 "Could not parse PDF…"`. Ensure the logged error (`console.error('Parse failed:', …)`) logs only `err.message`/`err.name` and **never** the password. Consider mapping a final `PasswordException` to a clearer message like *"This PDF is password-protected and the stored password did not unlock it."* (422) — but still without echoing the password.

### 3. Secret configuration — `.env.example`

- Add `PDF_PASSWORD=` (empty placeholder) with a comment that the real value goes in `.env.local` (dev) and the Amplify Console (prod).
- **Do not** commit the real password anywhere. It belongs only in `.env.local` (gitignored) and Amplify.

### 4. Test — `lib/__tests__/` (optional but recommended)

- Add a parser test for the password path. Follow the existing convention: guard the gitignored sample PDF with `existsSync` + `describe.skipIf` so CI (which has no PDFs) skips it.
- If you have a password-protected sample, assert it parses with the password and throws without it. If you only have the unprotected sample, at minimum assert the unprotected path still returns the known May-2026 acceptance numbers.

## Files affected

- `lib/parsers/tpbank.ts` — modify (optional `password`, try-then-retry)
- `app/api/parse/route.ts` — modify (pass `process.env.PDF_PASSWORD`, safe error mapping)
- `.env.example` — modify (add `PDF_PASSWORD=`)
- `lib/__tests__/tpbank.test.ts` — **create** (optional)

## Acceptance criteria

- Uploading a **password-protected** statement (with `PDF_PASSWORD` set correctly) parses and saves successfully.
- Uploading a **non-protected** statement still works unchanged.
- With `PDF_PASSWORD` unset/wrong, a protected upload fails with a clear `422` — and the server logs do **not** contain the password.
- `grep -rn "PDF_PASSWORD" app/ lib/` shows it read only from `process.env`, never assigned a literal.
- `pnpm build`, `pnpm lint`, and `pnpm test` pass.

## Notes & gotchas

- **Secret handling is the point of this step.** The password is a static env var (`PDF_PASSWORD`), server-side only — it is never sent to the client and the parse route runs on the Node runtime. Never log it, never include it in a JSON response, never add it to the Gemini/S3 payloads.
- The "try unprotected first" order means a single code path handles both protected and unprotected PDFs without the caller knowing which it is.
- Destroy **every** `PDFParse` instance you create (the retry creates a second one) to avoid leaking pdf.js workers.

## Next step

[Step 17 — Google authentication (single user)](./17-google-auth.md)
