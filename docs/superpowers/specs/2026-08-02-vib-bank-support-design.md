# VIB bank support — design

**Date:** 2026-08-02
**Status:** Approved, ready for implementation planning

## Problem

Cashight parses statements from one bank, TPBank. Add Vietnam International Bank
(VIB) as a second supported bank:

1. Uploads auto-detect which bank issued the statement — the user picks nothing.
2. The dashboard gains a bank dropdown (short names: TPB, VIB) to narrow the view.
3. The VIB sample PDF is password-protected (a different password from TPBank's),
   and that password is handled with the same secrecy as the existing one.

## Findings that shape the design

Established by extracting text from
`vib_saoke_07_2026_VIB Rewards Unlimited_C000000000786286_59465230.pdf`:

- **VIB text extraction order is jumbled.** The two-column header emits text items
  out of reading order, so a regex-over-lines parser like `parsers/tpbank.ts`
  cannot pair labels with values. Grouping text items by y coordinate (±2) and
  sorting by x reconstructs the page exactly: every label and its value land on one
  row, and the transaction table has stable columns (transaction date `x≈30`, post
  date `x≈101`, details `x≈172`, MCC `x≈362`, amount right-aligned `x≥516`).
- **The number format is inverted.** VIB writes `5,591,567.00` — comma thousands
  separator, dot decimal — the opposite of TPBank's `17.184.741`.
- **The PAN is already masked in the source PDF** (`526887******4550`), so
  `cardLast4 = '4550'`. No collision with TPBank's `9674`.
- **VIB descriptions embed PII.** Example payment row:
  `526887xxxxxx4550-000000000786286 - NGUYEN GIA HUY - Thanh toan sao ke the Master Card 06/2026`
  — masked PAN, card-account number, and the cardholder's name.
- **`pdf-parse` cannot produce coordinates**, but `pdfjs-dist` (its engine) is
  already a pinned direct dependency of the root package and is already bundled
  into `parser-worker` (`scripts/build-lambdas.mjs` copies `pdf.worker.mjs`).
- Detection markers are unambiguous: TPBank statements contain
  `TPBANK CREDIT CARD`; VIB statements contain `Vietnam International Bank`.
- The sample month has 3 transactions: a payment (`-5,591,567.00`), an installment
  (`GD GOC TRA GOP KY HAN 3/12 TAI CELLPHONES`, `5,581,667.00`), and an SMS fee
  (`9,900.00`). Debits reconcile against the statement's own total:
  `5,581,667 + 9,900 = 5,591,567`.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Bank filter | "All banks" default + per-bank, in the URL as `?bank=` | Preserves today's combined view; consistent with "URL is the source of truth for period state" |
| Storage key | Unchanged (`statements/{cardLast4}/…`) | `9674` and `4550` don't collide; avoids re-keying S3, the DynamoDB SK, and `statementId` parsing |
| PDF password | JSON map in the **existing** secret | No Terraform, no new IAM grant, no new env var |
| `bank` field values | `z.enum(['TPBank','VIB'])` + short-name label map | Existing stored statements keep validating; no data migration |
| Statements list | Gains a Bank column | `bank` optional on the metadata record, defaults to `'TPBank'` on read — no backfill |
| Categorization | Description rules only; MCC parsed but unused | One categorization path for both banks |
| Fixture | Moves to `test-pdfs/` | Matches the existing convention; `*.pdf` is gitignored repo-wide |

## Architecture

### Bank registry

New `packages/domain/src/banks.ts` — the single place that knows a bank exists.

```ts
export const BANK_CODES = ['TPBank', 'VIB'] as const;
export type BankCode = (typeof BANK_CODES)[number];

interface BankProfile {
  code: BankCode;
  shortName: string;  // 'TPB' | 'VIB' — the dropdown label
  detect: RegExp;     // /TPBANK CREDIT CARD/i | /Vietnam International Bank/i
}

export function detectBank(text: string): BankCode | null;
export function bankShortName(code: BankCode): string;
```

`StatementSchema.bank` changes from `z.literal('TPBank')` to `z.enum(BANK_CODES)`.
Nothing else in the schema changes; statements already in S3 still validate.

### Parse dispatch

`parseTPBankStatement` opens the PDF itself today. Split it so the text-extraction
step is shared and the parsing logic stays pure:

- `parseTPBankStatementFromText(text): Statement` — the existing body, unchanged.
- `parseTPBankStatement(buffer, password)` — thin wrapper, preserved for the
  existing script and tests. **No behaviour change to a shipped, verified parser.**

New dispatcher `packages/domain/src/parsers/index.ts`:

```
parseStatementPdf(buffer, passwords: string[]): Promise<Statement>
  1. extractText(buffer, passwords) → { text, password }   // pdf-parse; tries
     no password first, then each candidate on PasswordException
  2. detectBank(text)
       'TPBank' → parseTPBankStatementFromText(text)
       'VIB'    → parseVIBStatement(buffer, password)
       null     → throw UnsupportedBankError
```

The VIB path opens the PDF a second time to read coordinates. That is deliberate:
it keeps the TPBank parser byte-for-byte on its verified `pdf-parse` input, and the
cost is negligible on a 3-page document. `extractText` returns the working password
so the second pass does not re-try candidates.

### VIB parser

New `packages/domain/src/parsers/pdf-layout.ts`:

```ts
export interface LayoutCell { x: number; text: string }
export interface LayoutRow { y: number; cells: LayoutCell[] }
export interface LayoutPage { pageNumber: number; rows: LayoutRow[] }

export async function extractPdfLayout(
  buffer: Buffer,
  password?: string,
): Promise<LayoutPage[]>;
```

Imports `pdfjs-dist` directly (after `../pdf-dom-polyfill`, same ordering
constraint as `parsers/tpbank.ts`). Groups text items into rows by y within ±2,
sorts rows by descending y and cells by ascending x. Pure geometry — no bank
knowledge.

New `packages/domain/src/parsers/vib.ts`:

- **Header fields** by label→value on the same row. Either the Vietnamese or the
  English parenthetical label anchors the lookup:
  - `Ngày sao kê` / `(Statement Date)` → `statementDate`
  - `Ngày đến hạn thanh toán` / `(Payment Due Date)` → `paymentDueDate`
  - `Hạn mức tín dụng` / `(Credit Limit)` → `creditLimit` — anchored so it does
    **not** match `Hạn mức tín dụng dự phòng` (`(Extra Limit)`)
  - `Dư nợ kỳ trước` / `(Previous Balance)` → `totals.previousBalance`
  - `Dư nợ cuối kỳ` / `(End Balance)` → `totals.statementBalance`
  - `Thanh toán tối thiểu` / `(Minimum Payment Due)` → `totals.minimumPayment`
  - `Số thẻ chính` / `(Primary Card Number)` → last 4 digits of `526887******4550`
  - A missing required field throws with the field name, mirroring TPBank's
    `requireMatch`.
- **`parseVibAmount(raw)`** — strips commas, parses the decimal, rounds to an
  integer VND, preserves sign. This is the only place the comma format is
  converted, mirroring the rule that TPBank's dot format is converted only in
  `parsers/tpbank.ts`.
- **Transactions** — a row starts when its first two cells are both `dd/mm/yyyy`.
  Rows carrying only a details-column cell (no date) fold into the previous
  transaction's description. Card sub-headers (`Số thẻ / Số tài khoản`), the column
  header, page footers (`Vietnam International Bank | Tel:`, `P n/3`), the summary
  block (`Phát sinh nợ trong kỳ`) and the points block (`Chương trình điểm thưởng`)
  are skipped. Scanning starts at `Chi tiết giao dịch` and continues across pages.
  The amount is the rightmost numeric cell; MCC is the cell near `x≈362` when
  present (parsed, currently unused).
- **Signs** — VIB prints credits negative (`-5,591,567.00`), matching the schema's
  convention that `amountVnd` is negative for credits. `originalAmount` is the
  absolute value.
- **Row classification → totals**
  - `isInstallment`: `/TRA GOP/i` → `totals.totalInstallments`
  - fees/interest: `/^Phi\b|^Lai\b/i` → `totals.totalFeesAndInterest`
  - credits (`amountVnd < 0`): payments — excluded from every debit total
  - `HOAN TIEN` credits → `totals.totalCashback` (magnitude); otherwise `0` —
    VIB Rewards Unlimited pays points, not cashback
  - everything else positive → `totals.totalSpend`
- **Integrity check** — the parser asserts
  `totalSpend + totalInstallments + totalFeesAndInterest === "Phát sinh nợ trong kỳ"`
  (the statement's own total-debit figure) and throws when they disagree. This is
  the defence against a silently mis-parsed future month.
- **`isInternational`** is `false` and `currency` is `'VND'` for every row. The
  sample contains no foreign transaction, so there is no evidence to build a rule
  on. Revisit when such a statement appears.

### PCI: description scrubbing

`scrubVibDescription(raw)` runs before `categorize()` / `normalizeMerchant()`:

1. Remove PAN-shaped tokens (`\d{6}[x*]{6}\d{4}`).
2. Remove long bare digit runs (the card-account number).
3. Collapse `Thanh toan sao ke …` rows to a plain payment label, which removes the
   cardholder-name segment.

This matters because `buildSummaryPayload()` sends top-merchant names to Gemini.
`lib/__tests__/architecture-privacy.test.ts` gains a case asserting that no parsed
VIB description matches a PAN pattern, a long digit run, or the cardholder name.

### Password handling

The Secrets Manager secret value becomes a JSON map:

```json
{"TPB": "…", "VIB": "26034550"}
```

New pure helper `parsePdfPasswords(secretString): string[]` accepts either shape —
a plain string yields a one-element list — so the deploy and the secret rotation do
not have to be simultaneous. The JSON **keys are human labels only**: the helper
returns the values in declaration order and the parser tries them in sequence.
Keying passwords by bank would be circular — the PDF must be decrypted before its
bank can be detected. Passwords are never logged, exactly as today. No Terraform
resource, IAM statement, or env var changes.

Local stack: `scripts/local/handlers.ts` reads `PDF_PASSWORDS` (same JSON shape),
falling back to `PDF_PASSWORD`.

### Dashboard bank filter

- `aggregate(statements, spec, options?: { bank?: BankCode })` filters by period
  first, computes `availableBanks` from the period's statements, then applies the
  bank filter to everything else. Stays pure and keeps the logic in one place.
- `AggregatedView.availableBanks?: BankCode[]` — optional, for the same
  cached-SPA-bundle reason already documented for `latestStatement`, and mirrored in
  `AggregatedViewSchema` so the `satisfies` assertion keeps them in step.
- `parseBankFromSearch(searchParams): BankCode | null` in the domain package, beside
  `parsePeriodFromSearch`. Absent or unrecognised → `null` → all banks.
- `dashboard-api` forwards the parsed bank into `aggregate()`.
- `frontend/hooks/use-dashboard.ts` includes `bank` in the request query string and
  in its refetch key.
- New `BankSelector` beside `PeriodSelector` in the dashboard header. Options are
  "All banks" plus each entry of `availableBanks`, labelled by short name. Changing
  the bank preserves the existing period params. The selector always renders.
- Requires a new `components/ui/select.tsx` (Radix Select; `radix-ui` is already a
  dependency and no select primitive exists yet), styled to match the existing
  admin-template components.

### Statements list

- `StatementMetadataRecord.bank?: BankCode` — optional in the Zod record schema;
  readers default to `'TPBank'`, which is correct for every existing record. No
  backfill script.
- `parser-worker`'s `writeMetadata` writes `bank: statement.bank`.
- `statements-api`'s `metaToSummary` emits `bank`; `StatementListItemSchema` gains
  the field; `app/components/statements-table.tsx` gains a Bank column.

### Error handling

- New job error code `UNSUPPORTED_BANK`, raised when `detectBank` returns `null`
  (today this would surface as a generic `PARSE_ERROR`). `process-job.ts` gains an
  `isUnsupportedBankError` branch beside the existing `isPasswordError` branch,
  transitioning the job to `FAILED` with that code before deleting the PDF.
- `ProcessJobDependencies.parsePdf` changes from `(buffer, password?)` to
  `(buffer, passwords: string[])`, and `process-job.ts` passes the parsed candidate
  list through instead of a single string.
- `packages/domain/src/upload-error.ts` maps it to: *"We couldn't recognise this
  statement's bank. Cashight supports TPBank and VIB."*
- `WRONG_PASSWORD` semantics change slightly: it now means no candidate password
  worked.

## Testing

Fixture-independent tests (always run in CI):

- row grouping in `pdf-layout.ts` from synthetic text items
- `parseVibAmount` on the comma-thousands format, including negatives
- `scrubVibDescription` against the PAN / account-number / cardholder-name payload
- `detectBank` on TPBank and VIB marker text, and on unrecognised text
- `parsePdfPasswords` for the plain-string, JSON-map and empty cases
- the bank filter and `availableBanks` in `aggregate()`
- `parseBankFromSearch` URL parsing

Fixture-dependent (self-skipping via the existing `existsSync` pattern):

- `lib/__tests__/vib.test.ts` against `test-pdfs/vib_saoke_07_2026_*.pdf`
- `scripts/test-parser.ts` gains a VIB section

VIB acceptance numbers for the July 2026 statement:

| Field | Value |
|---|---|
| `bank` | `'VIB'` |
| `cardLast4` | `'4550'` |
| `statementDate` | `'2026-07-25'` |
| `paymentDueDate` | `'2026-08-10'` |
| `creditLimit` | `124000000` |
| `totals.previousBalance` | `5591567` |
| `totals.statementBalance` | `5591567` |
| `totals.minimumPayment` | `5582360` |
| `totals.totalSpend` | `0` |
| `totals.totalInstallments` | `5581667` |
| `totals.totalFeesAndInterest` | `9900` |
| `totals.totalCashback` | `0` |
| `transactions.length` | `3` |

Regression guard: the TPBank acceptance numbers in `CLAUDE.md` must still pass
unchanged after the `parseTPBankStatementFromText` split.

## Documentation to update

`CLAUDE.md`, `AGENTS.md`, `README.md`, `.env.example`, `docs/local-development.md` —
two supported banks, the JSON password-map format, and the VIB acceptance numbers.

## Known risks

- **One sample month, and it is degenerate.** Previous balance, end balance, total
  debit and total credit are all `5,591,567.00`, so a label/value mix-up would not
  show up in the numbers. Mitigations: coordinate-based label→value pairing (not
  positional guessing) and the debit-total reconciliation check, which makes a
  mis-parse fail loudly instead of storing wrong data.
- **No foreign-currency VIB sample.** `currency` and `isInternational` are hardcoded
  for VIB rows. Revisit when a statement with an international transaction appears.
- **`cardLast4`-only storage keys.** If a future card shares a last-4 across the two
  banks, their statements would overwrite each other. Accepted for now; the fix is a
  bank-qualified key plus a data migration.
