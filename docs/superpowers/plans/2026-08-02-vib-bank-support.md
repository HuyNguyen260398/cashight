# VIB Bank Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vietnam International Bank (VIB) as a second supported statement source — auto-detected on upload, filterable on the dashboard by short bank name.

**Architecture:** A bank registry in the domain package owns bank codes, short names, detection markers, and URL parsing. PDF text is extracted once, the bank is detected from marker strings, and the buffer is routed to a bank-specific parser. TPBank keeps its existing `pdf-parse` text pipeline untouched; VIB uses a new coordinate-based layout extractor (`pdfjs-dist`) because its two-column header emits text out of reading order. The dashboard filter lives in the URL (`?bank=`) and is applied inside the pure `aggregate()` function.

**Tech Stack:** TypeScript, Zod 4, `pdf-parse` 2.4.5, `pdfjs-dist` 5.4.296, Vitest 4, React 19 / Next 16, Radix UI, AWS Lambda + DynamoDB + S3.

**Spec:** `docs/superpowers/specs/2026-08-02-vib-bank-support-design.md`

## Global Constraints

- **PCI hygiene.** The full/BIN PAN must never appear in logs, API responses, storage keys, persisted JSON, test output, or AI payloads. VIB descriptions embed a masked PAN, a card-account number, and the cardholder's name — they must be scrubbed inside the parser, before `categorize()` / `normalizeMerchant()`.
- **Never log passwords.** Neither the secret string, the parsed candidate list, nor any element of it.
- **`../pdf-dom-polyfill` must be imported BEFORE any `pdfjs-dist` or `pdf-parse` import** in the same module. `pdfjs-dist` references `DOMMatrix` while its module body evaluates; verified to crash the esbuild CJS bundle if the order is wrong.
- **Number formats stay in their parser.** TPBank's dot-thousands conversion lives only in `parsers/tpbank.ts`; VIB's comma-thousands/dot-decimal conversion lives only in `parsers/vib-fields.ts`.
- **Zod at the boundary.** Parser output and anything read from S3 goes through `StatementSchema.parse()`.
- **No behaviour change to the TPBank parser.** The acceptance numbers in `CLAUDE.md` (`statementBalance 37978402`, `totalSpend 26986712`, `totalCashback 519020`, `totalInstallments 10749850`, `totalFeesAndInterest 760860`, 41 transactions, `cardLast4 '9674'`) must still pass after the text/buffer split.
- **Storage keys are unchanged.** `users/{sub}/statements/{cardLast4}/{year}/{year}-{mm}.json`, `statementId = {year}-{mm}-{cardLast4}`, SK `STATEMENT#{year}-{mm}#{cardLast4}`. Do not add the bank to any key.
- **Bank code values are `'TPBank'` and `'VIB'`** exactly (stored in S3 JSON). Short names `'TPB'` and `'VIB'` are display-only.
- Style: two-space indent, single quotes, trailing commas, semicolons, camelCase functions, PascalCase types, kebab-case filenames, `@/` alias for repo-root imports.
- Commands: `pnpm test` (vitest run), `pnpm test <file>` for one file, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build:lambdas`.
- Work on a feature branch — `main` is PR-protected.

## File Structure

**Created**
| File | Responsibility |
|---|---|
| `packages/domain/src/banks.ts` | Bank codes, short names, detection markers, `?bank=` URL parsing |
| `packages/domain/src/parsers/pdf-text.ts` | Shared `pdf-parse` text extraction with a password candidate list |
| `packages/domain/src/parsers/pdf-layout.ts` | Coordinate-based row/cell extraction via `pdfjs-dist` (pure geometry, no bank knowledge) |
| `packages/domain/src/parsers/vib-fields.ts` | VIB amount/date parsing and description scrubbing (pure, no PDF) |
| `packages/domain/src/parsers/vib.ts` | VIB layout → `Statement` |
| `packages/domain/src/parsers/index.ts` | `parseStatementPdf` dispatcher + `UnsupportedBankError` |
| `backend/shared/pdf-passwords.ts` | `parsePdfPasswords` (pure; no AWS import, so `process-job` tests stay unit tests) |
| `components/ui/select.tsx` | Radix Select primitive (none exists yet) |
| `app/components/bank-selector.tsx` | Dashboard bank dropdown |
| `lib/banks.ts` | Client-safe re-export shim of `@cashight/domain/banks` |
| `lib/__tests__/banks.test.ts`, `pdf-layout.test.ts`, `vib-fields.test.ts`, `vib.test.ts` | Domain tests |
| `backend/__tests__/pdf-passwords.test.ts` | Password-list tests |
| `app/__tests__/bank-selector.test.tsx` | Selector render test |

**Modified**
| File | Change |
|---|---|
| `packages/domain/package.json` | New export subpaths |
| `packages/domain/src/schemas.ts` | `bank` becomes an enum; `AggregatedViewSchema.availableBanks` |
| `packages/domain/src/parsers/tpbank.ts` | Split into `parseTPBankStatementFromText` + buffer wrapper |
| `packages/domain/src/categorize.ts` | Structural rules widened to VIB's wording |
| `packages/domain/src/aggregations.ts` | `aggregate()` gains options; `AggregatedView.availableBanks` |
| `packages/domain/src/upload-error.ts` | Error-code → user message map |
| `backend/shared/metadata.ts` | `bank` on the statement metadata record |
| `backend/functions/parser-worker/process-job.ts` | Password list, dispatcher, `UNSUPPORTED_BANK`, `bank` in metadata |
| `backend/functions/parser-worker/handler.ts` | Wire the dispatcher + `bank` |
| `backend/functions/statements-api/handler.ts` | `bank` in the list item |
| `backend/functions/dashboard-api/handler.ts` | Forward `?bank=` into `aggregate()` |
| `frontend/api/contracts.ts` | `bank` on `StatementListItemSchema` |
| `frontend/hooks/use-dashboard.ts` | Bank in query + refetch key |
| `frontend/hooks/use-statements.ts` | Map `bank` into the row |
| `frontend/hooks/use-upload-job.ts` | Friendly error messages |
| `app/page.tsx` | Read `?bank=`, render `BankSelector` |
| `app/components/statements-table.tsx` | Bank column |
| `scripts/local/handlers.ts` | Local password list + dispatcher |
| `scripts/test-parser.ts` | VIB acceptance section |
| `lib/__tests__/architecture-privacy.test.ts` | VIB scrub invariant |
| `CLAUDE.md`, `AGENTS.md`, `README.md`, `.env.example`, `docs/local-development.md` | Documentation |

---

### Task 1: Bank registry and schema enum

**Files:**
- Create: `packages/domain/src/banks.ts`
- Create: `lib/banks.ts`
- Create: `lib/__tests__/banks.test.ts`
- Modify: `packages/domain/package.json` (exports map)
- Modify: `packages/domain/src/schemas.ts:31` (`bank` field)

**Interfaces:**
- Consumes: nothing.
- Produces: `BANK_CODES: readonly ['TPBank','VIB']`, `type BankCode = 'TPBank' | 'VIB'`, `detectBank(text: string): BankCode | null`, `bankShortName(code: BankCode): string`, `isBankCode(value: unknown): value is BankCode`, `parseBankFromSearch(params: URLSearchParams): BankCode | null`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/banks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  BANK_CODES,
  bankShortName,
  detectBank,
  isBankCode,
  parseBankFromSearch,
} from '@cashight/domain/banks';

describe('detectBank', () => {
  it('detects TPBank from its card-type marker', () => {
    expect(detectBank('Loai the\nCard Type TPBANK CREDIT CARD Thanh toan')).toBe(
      'TPBank',
    );
  });

  it('detects VIB from its footer marker', () => {
    expect(
      detectBank('Vietnam International Bank | Tel: +84 24 62585858'),
    ).toBe('VIB');
  });

  it('detects VIB from its statement title', () => {
    expect(detectBank('Sao kê giao dịch thẻ tín dụng VIB')).toBe('VIB');
  });

  it('returns null for an unrecognised statement', () => {
    expect(detectBank('SOME OTHER BANK MONTHLY STATEMENT')).toBeNull();
  });
});

describe('bankShortName', () => {
  it('maps TPBank to TPB', () => {
    expect(bankShortName('TPBank')).toBe('TPB');
  });

  it('maps VIB to VIB', () => {
    expect(bankShortName('VIB')).toBe('VIB');
  });

  it('covers every bank code', () => {
    for (const code of BANK_CODES) {
      expect(bankShortName(code).length).toBeGreaterThan(0);
    }
  });
});

describe('isBankCode', () => {
  it('accepts known codes and rejects everything else', () => {
    expect(isBankCode('VIB')).toBe(true);
    expect(isBankCode('TPBank')).toBe(true);
    expect(isBankCode('TPB')).toBe(false);
    expect(isBankCode(undefined)).toBe(false);
  });
});

describe('parseBankFromSearch', () => {
  it('returns null when the param is absent', () => {
    expect(parseBankFromSearch(new URLSearchParams())).toBeNull();
  });

  it('returns null for an unknown value', () => {
    expect(parseBankFromSearch(new URLSearchParams('bank=Sacombank'))).toBeNull();
  });

  it('returns the code for a known value', () => {
    expect(parseBankFromSearch(new URLSearchParams('bank=VIB'))).toBe('VIB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/__tests__/banks.test.ts`
Expected: FAIL — cannot resolve `@cashight/domain/banks`.

- [ ] **Step 3: Create the bank registry**

Create `packages/domain/src/banks.ts`:

```ts
/**
 * The single place that knows which banks Cashight supports.
 *
 * `code` is the value persisted in statement JSON (S3) — never change an
 * existing one without a data migration. `shortName` is display-only.
 * `detect` is matched against the plain text extracted from an uploaded PDF.
 */

export const BANK_CODES = ['TPBank', 'VIB'] as const;
export type BankCode = (typeof BANK_CODES)[number];

interface BankProfile {
  code: BankCode;
  shortName: string;
  detect: RegExp;
}

const BANK_PROFILES: readonly BankProfile[] = [
  {
    code: 'TPBank',
    shortName: 'TPB',
    detect: /TPBANK CREDIT CARD/i,
  },
  {
    code: 'VIB',
    shortName: 'VIB',
    detect: /Vietnam International Bank|Sao kê giao dịch thẻ tín dụng VIB/i,
  },
];

/** Identify the issuing bank from extracted PDF text; null when unrecognised. */
export function detectBank(text: string): BankCode | null {
  for (const profile of BANK_PROFILES) {
    if (profile.detect.test(text)) return profile.code;
  }
  return null;
}

/** Display label for a bank code (e.g. 'TPBank' -> 'TPB'). */
export function bankShortName(code: BankCode): string {
  const profile = BANK_PROFILES.find((p) => p.code === code);
  return profile ? profile.shortName : code;
}

export function isBankCode(value: unknown): value is BankCode {
  return (
    typeof value === 'string' && (BANK_CODES as readonly string[]).includes(value)
  );
}

/**
 * Read the dashboard bank filter out of the URL. Absent or unrecognised means
 * "all banks" — the same forgiving contract as parsePeriodFromSearch.
 */
export function parseBankFromSearch(
  params: URLSearchParams,
): BankCode | null {
  const raw = params.get('bank');
  return isBankCode(raw) ? raw : null;
}
```

- [ ] **Step 4: Add the export subpath**

In `packages/domain/package.json`, add to `exports`, immediately after `"./schemas"`:

```json
    "./banks": "./src/banks.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test lib/__tests__/banks.test.ts`
Expected: PASS (all 11 tests).

- [ ] **Step 6: Widen the schema's bank field**

In `packages/domain/src/schemas.ts`, add the import at the top (after the `zod` import):

```ts
import { BANK_CODES } from './banks';
```

Then change line 31 from:

```ts
  bank: z.literal('TPBank'),
```

to:

```ts
  bank: z.enum(BANK_CODES),
```

- [ ] **Step 7: Add the client-safe lib shim**

Create `lib/banks.ts` (no `server-only` import — this is consumed by a client component):

```ts
export {
  BANK_CODES,
  bankShortName,
  detectBank,
  isBankCode,
  parseBankFromSearch,
} from '@cashight/domain/banks';
export type { BankCode } from '@cashight/domain/banks';
```

- [ ] **Step 8: Verify the whole suite and types still pass**

Run: `pnpm test && pnpm tsc --noEmit`
Expected: PASS. Existing statements with `bank: 'TPBank'` still validate because `'TPBank'` is a member of the enum.

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/banks.ts packages/domain/src/schemas.ts \
  packages/domain/package.json lib/banks.ts lib/__tests__/banks.test.ts
git commit -m "feat: add bank registry and widen the statement bank field to an enum"
```

---

### Task 2: Coordinate-based PDF layout extraction

VIB's two-column header emits text items out of reading order, so `pdf-parse`'s line-based output cannot pair labels with values. Grouping items by y and sorting by x reconstructs the page exactly.

**Files:**
- Create: `packages/domain/src/parsers/pdf-layout.ts`
- Create: `lib/__tests__/pdf-layout.test.ts`
- Modify: `packages/domain/package.json` (exports map)

**Interfaces:**
- Consumes: nothing.
- Produces: `interface LayoutCell { x: number; text: string }`, `interface LayoutRow { y: number; cells: LayoutCell[] }`, `interface LayoutPage { pageNumber: number; rows: LayoutRow[] }`, `interface RawTextItem { text: string; x: number; y: number }`, `groupItemsIntoRows(items: RawTextItem[], yTolerance?: number): LayoutRow[]`, `rowText(row: LayoutRow): string`, `extractPdfLayout(buffer: Buffer, password?: string): Promise<LayoutPage[]>`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/pdf-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  groupItemsIntoRows,
  rowText,
  type RawTextItem,
} from '@cashight/domain/parsers/pdf-layout';

const items: RawTextItem[] = [
  // Deliberately out of reading order, the way VIB emits them.
  { text: '124,000,000.00', x: 220, y: 624 },
  { text: 'Sao kê giao dịch thẻ tín dụng VIB', x: 30, y: 801 },
  { text: '(Credit Limit)', x: 101, y: 624 },
  { text: 'Hạn mức tín dụng', x: 30, y: 625 },
  { text: '   ', x: 400, y: 624 },
];

describe('groupItemsIntoRows', () => {
  it('sorts rows top-to-bottom by descending y', () => {
    const rows = groupItemsIntoRows(items);
    expect(rows[0].cells[0].text).toBe('Sao kê giao dịch thẻ tín dụng VIB');
  });

  it('groups items within the y tolerance into one row, ordered by x', () => {
    const rows = groupItemsIntoRows(items);
    expect(rows[1].cells.map((c) => c.text)).toEqual([
      'Hạn mức tín dụng',
      '(Credit Limit)',
      '124,000,000.00',
    ]);
  });

  it('drops whitespace-only items', () => {
    const rows = groupItemsIntoRows(items);
    expect(rows.flatMap((r) => r.cells).some((c) => c.text.trim() === '')).toBe(
      false,
    );
  });

  it('keeps items further apart than the tolerance in separate rows', () => {
    const rows = groupItemsIntoRows(
      [
        { text: 'a', x: 10, y: 100 },
        { text: 'b', x: 20, y: 90 },
      ],
      2,
    );
    expect(rows).toHaveLength(2);
  });
});

describe('rowText', () => {
  it('joins a row into a single space-separated string', () => {
    const rows = groupItemsIntoRows(items);
    expect(rowText(rows[1])).toBe('Hạn mức tín dụng (Credit Limit) 124,000,000.00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/__tests__/pdf-layout.test.ts`
Expected: FAIL — cannot resolve `@cashight/domain/parsers/pdf-layout`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/parsers/pdf-layout.ts`. Note the import order constraint — the polyfill import MUST come first.

```ts
/**
 * Coordinate-based text extraction: reconstructs a PDF page as rows of cells
 * using each text item's x/y position.
 *
 * `pdf-parse` groups lines by the vertical distance between *consecutive* text
 * items in content-stream order. That works for a single-column statement like
 * TPBank's, but a two-column layout (VIB) emits items out of reading order and
 * the grouping falls apart. Sorting by absolute position instead is immune to
 * emission order.
 *
 * Pure geometry — this module knows nothing about any particular bank.
 */

// MUST precede the pdfjs-dist import: pdfjs references `DOMMatrix` while its
// module body evaluates. See ../pdf-dom-polyfill.ts.
import '../pdf-dom-polyfill';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface RawTextItem {
  text: string;
  x: number;
  y: number;
}

export interface LayoutCell {
  x: number;
  text: string;
}

export interface LayoutRow {
  y: number;
  cells: LayoutCell[];
}

export interface LayoutPage {
  pageNumber: number;
  rows: LayoutRow[];
}

/** Items whose y differs by no more than this belong to the same visual row. */
const DEFAULT_Y_TOLERANCE = 2;

/**
 * Bucket text items into visual rows: same row when their y values are within
 * `yTolerance`. Rows are returned top-to-bottom (descending y, PDF origin is
 * bottom-left) and each row's cells left-to-right.
 */
export function groupItemsIntoRows(
  items: RawTextItem[],
  yTolerance: number = DEFAULT_Y_TOLERANCE,
): LayoutRow[] {
  const rows: LayoutRow[] = [];

  for (const item of items) {
    if (item.text.trim() === '') continue;
    const row = rows.find((r) => Math.abs(r.y - item.y) <= yTolerance);
    if (row) {
      row.cells.push({ x: item.x, text: item.text.trim() });
    } else {
      rows.push({ y: item.y, cells: [{ x: item.x, text: item.text.trim() }] });
    }
  }

  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
  }
  return rows;
}

/** Flatten a row into one space-separated string. */
export function rowText(row: LayoutRow): string {
  return row.cells.map((c) => c.text).join(' ');
}

/**
 * Extract every page of a PDF as positioned rows.
 *
 * A fresh Uint8Array is allocated per call because pdf.js transfers the typed
 * array to its worker and detaches it. The document is always destroyed.
 */
export async function extractPdfLayout(
  buffer: Buffer,
  password?: string,
): Promise<LayoutPage[]> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    password,
    isEvalSupported: false,
  });
  const doc = await task.promise;

  try {
    const pages: LayoutPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: RawTextItem[] = [];
      for (const item of content.items) {
        const textItem = item as { str?: string; transform?: number[] };
        if (typeof textItem.str !== 'string' || !textItem.transform) continue;
        items.push({
          text: textItem.str,
          x: Math.round(textItem.transform[4]),
          y: Math.round(textItem.transform[5]),
        });
      }
      pages.push({ pageNumber, rows: groupItemsIntoRows(items) });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
```

- [ ] **Step 4: Add the export subpath**

In `packages/domain/package.json`, add to `exports` after `"./parsers/tpbank"`:

```json
    "./parsers/pdf-layout": "./src/parsers/pdf-layout.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test lib/__tests__/pdf-layout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Verify the Lambda bundle still builds and can load pdfjs**

The `parser-worker` bundle needs `pdf.worker.mjs` beside `index.js`; `scripts/build-lambdas.mjs` already copies it. Confirm nothing regressed:

```bash
pnpm build:lambdas
ls dist/lambdas/parser-worker/
```

Expected: `index.js`, `index.js.map`, `pdf.worker.mjs` all present.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/parsers/pdf-layout.ts packages/domain/package.json \
  lib/__tests__/pdf-layout.test.ts
git commit -m "feat: add coordinate-based PDF layout extraction"
```

---

### Task 3: VIB field helpers and categorization rules

Pure string logic, no PDF involved, so these tests always run in CI.

**Files:**
- Create: `packages/domain/src/parsers/vib-fields.ts`
- Create: `lib/__tests__/vib-fields.test.ts`
- Modify: `packages/domain/src/categorize.ts:41-54` (`SPECIAL_RULES`)
- Modify/Create: `lib/__tests__/categorize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseVibAmount(raw: string): number`, `isVibAmount(raw: string): boolean`, `isDdMmYyyy(raw: string): boolean`, `toIsoDate(ddmmyyyy: string): string`, `scrubVibDescription(raw: string): string`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/vib-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  isDdMmYyyy,
  isVibAmount,
  parseVibAmount,
  scrubVibDescription,
  toIsoDate,
} from '@cashight/domain/parsers/vib-fields';

describe('parseVibAmount', () => {
  it('parses the comma-thousands, dot-decimal format to integer VND', () => {
    expect(parseVibAmount('5,591,567.00')).toBe(5_591_567);
  });

  it('preserves a negative sign (VIB prints credits negative)', () => {
    expect(parseVibAmount('-5,591,567.00')).toBe(-5_591_567);
  });

  it('rounds a fractional dong to the nearest integer', () => {
    expect(parseVibAmount('9,900.60')).toBe(9_901);
  });

  it('parses a value with no thousands separator', () => {
    expect(parseVibAmount('9900.00')).toBe(9_900);
  });

  it('throws on a non-numeric token', () => {
    expect(() => parseVibAmount('Thu Nợ Tối Thiểu')).toThrow();
  });
});

describe('isVibAmount', () => {
  it('accepts amounts and rejects dates and text', () => {
    expect(isVibAmount('124,000,000.00')).toBe(true);
    expect(isVibAmount('-5,591,567.00')).toBe(true);
    expect(isVibAmount('25/07/2026')).toBe(false);
    expect(isVibAmount('657704060067301')).toBe(false);
    expect(isVibAmount('3.38%/tháng')).toBe(false);
  });
});

describe('isDdMmYyyy / toIsoDate', () => {
  it('recognises and converts a VIB date', () => {
    expect(isDdMmYyyy('25/07/2026')).toBe(true);
    expect(isDdMmYyyy('2026-07-25')).toBe(false);
    expect(toIsoDate('25/07/2026')).toBe('2026-07-25');
    expect(toIsoDate('01/07/2026')).toBe('2026-07-01');
  });
});

describe('scrubVibDescription', () => {
  it('reduces a card-repayment row to a plain payment label', () => {
    expect(
      scrubVibDescription(
        '526887xxxxxx4550-000000000786286 - NGUYEN GIA HUY - Thanh toan sao ke the Master Card 06/2026',
      ),
    ).toBe('Thanh toan sao ke the');
  });

  it('removes an embedded masked PAN from a fee row', () => {
    expect(
      scrubVibDescription('Phi dich vu SMS The 526887******4550 THANG 072026'),
    ).toBe('Phi dich vu SMS The THANG 072026');
  });

  it('removes a bare card-account number', () => {
    expect(scrubVibDescription('GD TAI 000000000786286 SHOP')).toBe('GD TAI SHOP');
  });

  it('leaves a clean merchant description untouched', () => {
    expect(scrubVibDescription('GD GOC TRA GOP KY HAN 3/12 TAI CELLPHONES')).toBe(
      'GD GOC TRA GOP KY HAN 3/12 TAI CELLPHONES',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/__tests__/vib-fields.test.ts`
Expected: FAIL — cannot resolve `@cashight/domain/parsers/vib-fields`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/parsers/vib-fields.ts`:

```ts
/**
 * Field-level parsing for VIB statements: number format, date format, and
 * PCI-safe description cleanup. Pure string logic — no PDF, no I/O.
 *
 * VIB writes amounts as `5,591,567.00` (comma thousands separator, dot
 * decimal) — the exact opposite of TPBank's `17.184.741`. That conversion
 * lives here and nowhere else.
 */

/**
 * A VIB amount token: either comma-grouped (`5,591,567.00`) or an explicit
 * decimal (`9900.00`). A bare run of digits is deliberately NOT an amount —
 * the auto-debit account number (`657704060067301`) shares the End Balance row
 * and would otherwise be mistaken for one.
 */
const AMOUNT_RE = /^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+\.\d+$/;

/** A VIB date token. */
const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

/** A masked PAN as VIB prints it: 6 digits, 6 mask chars, 4 digits. */
const MASKED_PAN_RE = /\d{6}[x*]{6}\d{4}/gi;

/** A bare card-account number: a run of 9 or more digits. */
const LONG_DIGIT_RUN_RE = /\b\d{9,}\b/g;

/** Card-repayment rows carry the cardholder's name; they are replaced whole. */
const CARD_REPAYMENT_RE = /thanh toan sao ke/i;
const CARD_REPAYMENT_LABEL = 'Thanh toan sao ke the';

export function isVibAmount(raw: string): boolean {
  return AMOUNT_RE.test(raw.trim());
}

/** Parse a VIB amount into integer VND, preserving sign. Throws if invalid. */
export function parseVibAmount(raw: string): number {
  const token = raw.trim();
  if (!isVibAmount(token)) {
    throw new Error(`VIB parser: not an amount: "${token}"`);
  }
  const value = Number(token.replace(/,/g, ''));
  if (!Number.isFinite(value)) {
    throw new Error(`VIB parser: not an amount: "${token}"`);
  }
  return Math.round(value);
}

export function isDdMmYyyy(raw: string): boolean {
  return DATE_RE.test(raw.trim());
}

/** Convert DD/MM/YYYY -> YYYY-MM-DD. */
export function toIsoDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.trim().split('/');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Strip PII from a raw VIB transaction description.
 *
 * VIB embeds the masked PAN, the card-account number, and the cardholder's
 * name in some rows, e.g.
 *   "526887xxxxxx4550-000000000786286 - NGUYEN GIA HUY - Thanh toan sao ke the Master Card 06/2026"
 * Descriptions flow into stored JSON and into the top-merchant list that
 * `buildSummaryPayload()` sends to Gemini, so they must be cleaned here at the
 * parser boundary.
 */
export function scrubVibDescription(raw: string): string {
  // A repayment row is only ever "you paid your card" — the merchant name
  // carries no information and the row is where the cardholder's name lives.
  if (CARD_REPAYMENT_RE.test(raw)) return CARD_REPAYMENT_LABEL;

  return raw
    .replace(MASKED_PAN_RE, ' ')
    .replace(LONG_DIGIT_RUN_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–]+|[\s\-–]+$/g, '')
    .trim();
}
```

- [ ] **Step 4: Add the export subpath**

In `packages/domain/package.json`, add to `exports`:

```json
    "./parsers/vib-fields": "./src/parsers/vib-fields.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test lib/__tests__/vib-fields.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Write the failing categorization test**

VIB's structural markers differ from TPBank's: its installments read `GD GOC TRA GOP`, not `Giao dich tra gop`; its fees read `Phi dich vu`, not `Phi xu ly`; its repayments read `Thanh toan sao ke`, not `TT QUA TPBANK`. Without rules for them, a VIB fee would land in `Other` — and since `Other` is not in `NON_SPEND`, `dashboard-aggregations.totalSpend()` would count it as spend while the parser's `totals.totalSpend` did not. The two would silently disagree.

Append to `lib/__tests__/categorize.test.ts` (create the file with this content if it does not exist, importing `categorize` from `@cashight/domain/categorize`):

```ts
describe('categorize — VIB markers', () => {
  it('classifies a VIB installment row', () => {
    expect(categorize('GD GOC TRA GOP KY HAN 3/12 TAI CELLPHONES')).toBe(
      'Installments',
    );
  });

  it('classifies a VIB service fee', () => {
    expect(categorize('Phi dich vu SMS The THANG 072026')).toBe('Fees & Interest');
  });

  it('classifies a VIB card repayment', () => {
    expect(categorize('Thanh toan sao ke the')).toBe('Payment');
  });

  it('still classifies the TPBank equivalents', () => {
    expect(categorize('Giao dich tra gop SHOPEE')).toBe('Installments');
    expect(categorize('Phi xu ly GD quoc te')).toBe('Fees & Interest');
    expect(categorize('TT QUA TPBANK EBANK')).toBe('Payment');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm test lib/__tests__/categorize.test.ts`
Expected: FAIL — the three VIB cases return `'Other'`.

- [ ] **Step 8: Extend the special-case rules**

In `packages/domain/src/categorize.ts`, widen the three structural patterns in `SPECIAL_RULES`. Fees first, so `Phi dich vu` cannot be shadowed:

```ts
  // 1. Fees & interest. `Lai` (interest) is anchored to the line start with a
  //    word boundary so it does not match inside other words. `Phi dich vu` is
  //    VIB's service-fee wording.
  {
    pattern: /Instalment cancellation|Phi xu ly|Phi dich vu|^Lai\b/i,
    category: 'Fees & Interest',
  },
  // 2. Installment marker. TPBank writes "Giao dich tra gop"; VIB writes
  //    "GD GOC TRA GOP".
  { pattern: /Giao dich tra gop|GD GOC TRA GOP/i, category: 'Installments' },
  // 3. Cashback: contains HOAN TIEN or starts with CREDIT_.
  { pattern: /HOAN TIEN|^CREDIT_/i, category: 'Cashback' },
  // 4. Card repayment. TPBank writes "TT QUA TPBANK"; VIB writes
  //    "Thanh toan sao ke".
  { pattern: /TT QUA TPBANK|Thanh toan sao ke/i, category: 'Payment' },
```

Also update the module docstring's first line, which currently says the file is for "parsed TPBank credit-card statement transactions" — it now serves every supported bank.

- [ ] **Step 9: Run tests to verify they pass**

```bash
pnpm test lib/__tests__/categorize.test.ts
pnpm test && pnpm tsx scripts/test-parser.ts
```

Expected: PASS. The TPBank acceptance run is the regression gate — widening these patterns must not move any TPBank transaction into a different category, so its category-count checks must be unchanged.

- [ ] **Step 10: Commit**

```bash
git add packages/domain/src/parsers/vib-fields.ts packages/domain/src/categorize.ts \
  packages/domain/package.json lib/__tests__/vib-fields.test.ts \
  lib/__tests__/categorize.test.ts
git commit -m "feat: add VIB field parsing, description scrubbing, and categorization rules"
```

---

### Task 4: VIB statement parser

**Files:**
- Create: `packages/domain/src/parsers/vib.ts`
- Create: `lib/__tests__/vib.test.ts`
- Modify: `packages/domain/package.json` (exports map)
- Move: the sample PDF into `test-pdfs/`

**Interfaces:**
- Consumes: `LayoutPage`, `LayoutRow`, `LayoutCell`, `extractPdfLayout` (Task 2); `parseVibAmount`, `isVibAmount`, `isDdMmYyyy`, `toIsoDate`, `scrubVibDescription` (Task 3); `categorize`, `normalizeMerchant` from `../categorize`; `StatementSchema` from `../schemas`.
- Produces: `parseVibStatementFromLayout(pages: LayoutPage[]): Statement`, `parseVIBStatement(buffer: Buffer, password?: string): Promise<Statement>`.

**Column geometry** (measured from the sample; used as band boundaries, not exact matches): transaction date `x≈30`, post date `x≈101`, details `x≈172`, MCC `x≈362`, amount right-aligned `x≥516`.

- [ ] **Step 1: Move the fixture into `test-pdfs/`**

```bash
mv "vib_saoke_07_2026_VIB Rewards Unlimited_C000000000786286_59465230.pdf" \
   "test-pdfs/vib_saoke_07_2026_4550.pdf"
git status --short   # must show nothing: *.pdf and /test-pdfs/ are both gitignored
```

- [ ] **Step 2: Write the failing test**

Create `lib/__tests__/vib.test.ts`. It has a CI-safe half (synthetic layout rows) and a fixture-gated half.

```ts
/**
 * Vitest suite for @cashight/domain/parsers/vib.
 *
 * The synthetic-layout tests always run. The real-fixture acceptance test is
 * skipped when test-pdfs/ is absent (it is gitignored), so CI stays green.
 */

import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  parseVIBStatement,
  parseVibStatementFromLayout,
} from '@cashight/domain/parsers/vib';
import type { LayoutPage } from '@cashight/domain/parsers/pdf-layout';
import type { Statement } from '@cashight/domain/schemas';

const pdfPath = path.resolve(__dirname, '../../test-pdfs/vib_saoke_07_2026_4550.pdf');
const hasFixture = fs.existsSync(pdfPath);
const PDF_PASSWORD = '26034550';

/** A minimal but structurally faithful stand-in for the real July 2026 page. */
function syntheticPages(): LayoutPage[] {
  const row = (y: number, cells: Array<[number, string]>) => ({
    y,
    cells: cells.map(([x, text]) => ({ x, text })),
  });
  return [
    {
      pageNumber: 1,
      rows: [
        row(664, [
          [30, 'Số thẻ chính'],
          [82, '(Primary Card Number)'],
          [213, '526887******4550'],
        ]),
        row(624, [
          [30, 'Hạn mức tín dụng'],
          [101, '(Credit Limit)'],
          [220, '124,000,000.00'],
        ]),
        row(604, [
          [30, 'Hạn mức tín dụng dự phòng'],
          [140, '(Extra Limit)'],
          [229, '6,200,000.00'],
        ]),
        row(524, [
          [30, 'Ngày sao kê'],
          [78, '(Statement Date)'],
          [236, '25/07/2026'],
          [289, 'Dư nợ kỳ trước (VND)'],
          [377, '(Previous Balance)'],
          [518, '5,591,567.00'],
        ]),
        row(504, [
          [30, 'Ngày đến hạn thanh toán'],
          [129, '(Payment Due Date)'],
          [236, '10/08/2026'],
          [289, 'Phát sinh nợ trong kỳ (VND)'],
          [399, '(Total Debit Transaction)'],
          [518, '5,591,567.00'],
        ]),
        row(464, [
          [30, 'Số TK trích nợ'],
          [87, '(Auto Debit Account)'],
          [209, '657704060067301'],
          [289, 'Dư nợ cuối kỳ (VND)'],
          [371, '(End Balance)'],
          [518, '5,591,567.00'],
        ]),
        row(444, [
          [289, 'Thanh toán tối thiểu (VND)'],
          [395, '(Minimum Payment Due)'],
          [518, '5,582,360.00'],
        ]),
        row(414, [
          [30, 'Chi tiết giao dịch'],
          [101, '(Transaction info)'],
        ]),
        row(363, [
          [30, 'Số thẻ / Số tài khoản'],
          [172, '000000000786286'],
        ]),
        row(336, [
          [30, '01/07/2026'],
          [101, '01/07/2026'],
          [172, '526887xxxxxx4550-000000000786286 - NGUYEN'],
          [362, '6012-Member Financial'],
          [516, '-5,591,567.00'],
        ]),
        row(326, [[172, 'GIA HUY - Thanh toan sao ke the Master Card']]),
        row(317, [[172, '06/2026']]),
        row(277, [
          [30, '11/05/2026'],
          [101, '11/07/2026'],
          [172, 'GD GOC TRA GOP KY HAN 3/12 TAI'],
          [518, '5,581,667.00'],
        ]),
        row(267, [[172, 'CELLPHONES']]),
        row(258, [
          [30, '25/07/2026'],
          [101, '25/07/2026'],
          [172, 'Phi dich vu SMS The 526887******4550 THANG'],
          [534, '9,900.00'],
        ]),
        row(248, [[172, '072026']]),
        row(232, [
          [30, 'Phát sinh nợ trong kỳ (VND)'],
          [139, '(Total Debit Transaction)'],
          [518, '5,591,567.00'],
        ]),
      ],
    },
  ];
}

describe('parseVibStatementFromLayout', () => {
  const stmt = parseVibStatementFromLayout(syntheticPages());

  it('reports the bank as VIB', () => {
    expect(stmt.bank).toBe('VIB');
  });

  it('derives cardLast4 from the already-masked primary card number', () => {
    expect(stmt.cardLast4).toBe('4550');
  });

  it('reads the header dates', () => {
    expect(stmt.statementDate).toBe('2026-07-25');
    expect(stmt.paymentDueDate).toBe('2026-08-10');
  });

  it('reads the credit limit, not the extra limit', () => {
    expect(stmt.creditLimit).toBe(124_000_000);
  });

  it('reads the balances, ignoring the auto-debit account number', () => {
    expect(stmt.totals.previousBalance).toBe(5_591_567);
    expect(stmt.totals.statementBalance).toBe(5_591_567);
    expect(stmt.totals.minimumPayment).toBe(5_582_360);
  });

  it('splits debits into spend, installments, and fees', () => {
    expect(stmt.totals.totalSpend).toBe(0);
    expect(stmt.totals.totalInstallments).toBe(5_581_667);
    expect(stmt.totals.totalFeesAndInterest).toBe(9_900);
    expect(stmt.totals.totalCashback).toBe(0);
  });

  it('returns one transaction per dated row, skipping card sub-headers', () => {
    expect(stmt.transactions).toHaveLength(3);
  });

  it('signs credits negative and debits positive', () => {
    expect(stmt.transactions[0].amountVnd).toBe(-5_591_567);
    expect(stmt.transactions[1].amountVnd).toBe(5_581_667);
  });

  it('folds wrapped description lines into the transaction above', () => {
    expect(stmt.transactions[1].description).toContain('CELLPHONES');
  });

  it('scrubs the cardholder name and PAN out of descriptions', () => {
    const serialized = JSON.stringify(stmt.transactions);
    expect(serialized).not.toContain('NGUYEN');
    expect(serialized).not.toContain('4550-');
    expect(serialized).not.toContain('786286');
  });

  it('flags the installment row', () => {
    expect(stmt.transactions[1].isInstallment).toBe(true);
    expect(stmt.transactions[1].category).toBe('Installments');
  });

  it('throws when the debit total does not reconcile', () => {
    const pages = syntheticPages();
    const summary = pages[0].rows.find((r) =>
      r.cells.some((c) => c.text.startsWith('Phát sinh nợ trong kỳ')),
    )!;
    // Also corrupt the header copy so both occurrences disagree with the rows.
    for (const page of pages) {
      for (const r of page.rows) {
        for (const c of r.cells) {
          if (c.text === '5,591,567.00' && c.x >= 450) c.text = '9,999,999.00';
        }
      }
    }
    expect(summary).toBeDefined();
    expect(() => parseVibStatementFromLayout(pages)).toThrow(/reconcile/i);
  });
});

describe.skipIf(!hasFixture)('parseVIBStatement — real fixture', () => {
  let stmt: Statement;

  beforeAll(async () => {
    stmt = await parseVIBStatement(fs.readFileSync(pdfPath), PDF_PASSWORD);
  });

  it('matches the July 2026 acceptance numbers', () => {
    expect(stmt.bank).toBe('VIB');
    expect(stmt.cardLast4).toBe('4550');
    expect(stmt.statementDate).toBe('2026-07-25');
    expect(stmt.paymentDueDate).toBe('2026-08-10');
    expect(stmt.creditLimit).toBe(124_000_000);
    expect(stmt.totals.previousBalance).toBe(5_591_567);
    expect(stmt.totals.statementBalance).toBe(5_591_567);
    expect(stmt.totals.minimumPayment).toBe(5_582_360);
    expect(stmt.totals.totalSpend).toBe(0);
    expect(stmt.totals.totalInstallments).toBe(5_581_667);
    expect(stmt.totals.totalFeesAndInterest).toBe(9_900);
    expect(stmt.totals.totalCashback).toBe(0);
    expect(stmt.transactions).toHaveLength(3);
  });

  it('never leaks a PAN or the cardholder name', () => {
    const serialized = JSON.stringify(stmt);
    expect(serialized).not.toMatch(/\d{6}[x*]{6}\d{4}/i);
    expect(serialized).not.toContain('NGUYEN');
    expect(serialized).not.toMatch(/\b\d{9,}\b/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test lib/__tests__/vib.test.ts`
Expected: FAIL — cannot resolve `@cashight/domain/parsers/vib`.

- [ ] **Step 4: Write the implementation**

Create `packages/domain/src/parsers/vib.ts`:

```ts
/**
 * Deterministic parser for VIB (Vietnam International Bank) Vietnamese
 * credit-card PDF statements.
 *
 * NO LLM is involved. Unlike the TPBank parser, this one works off positioned
 * rows rather than extracted lines: VIB's two-column header emits text items
 * out of reading order, so labels and values only pair up reliably by
 * coordinate. See ./pdf-layout.ts.
 *
 * PCI: VIB already masks the PAN in the document (`526887******4550`), so only
 * the last 4 digits are ever read. Descriptions additionally embed the masked
 * PAN, the card-account number, and the cardholder name — every description is
 * passed through `scrubVibDescription` before it leaves this module.
 */

import { categorize, normalizeMerchant } from '../categorize';
import {
  StatementSchema,
  type Statement,
  type Transaction,
} from '../schemas';
import {
  extractPdfLayout,
  type LayoutPage,
  type LayoutRow,
} from './pdf-layout';
import {
  isDdMmYyyy,
  isVibAmount,
  parseVibAmount,
  scrubVibDescription,
  toIsoDate,
} from './vib-fields';

/** Column band boundaries, measured from the statement template. */
const COL_DETAILS_MIN = 150;
const COL_MCC_MIN = 350;
const COL_AMOUNT_MIN = 450;

/** Marks the start of the transaction table. */
const TABLE_START = /Chi tiết giao dịch/;

/** Rows that live inside the table but are not transactions. */
const TABLE_NOISE = [
  /Số thẻ \/ Số tài khoản/,
  /\(Card number \/ Account number\)/,
  /Ngày giao dịch/,
  /\(Transaction Date\)/,
  /Diễn giải/,
  /Số tiền \(VND\)/,
  /Vietnam International Bank \|/,
  /^P \d+\/$/,
];

/** The first row of the closing summary block — the table ends above it. */
const TABLE_END = /^Phát sinh nợ trong kỳ/;

/** Transaction classification markers. */
const INSTALLMENT_RE = /TRA GOP/i;
const FEE_RE = /^Phi\b|^Lai\b/i;
const CASHBACK_RE = /HOAN TIEN/i;

interface VibRow {
  txnDate: string;
  postDate: string;
  descriptionParts: string[];
  amountRaw: string;
  mcc?: string;
}

/**
 * Find the value belonging to a header label: the first cell to the RIGHT of
 * the label cell that matches `valueMatches`.
 *
 * "To the right" matters — the End Balance row also carries the auto-debit
 * account number in an earlier column, and a naive "first numeric cell in the
 * row" would pick that up instead.
 */
function findHeaderValue(
  pages: LayoutPage[],
  label: RegExp,
  valueMatches: (text: string) => boolean,
): string | undefined {
  for (const page of pages) {
    for (const row of page.rows) {
      const labelCell = row.cells.find((c) => label.test(c.text));
      if (!labelCell) continue;
      const value = row.cells.find(
        (c) => c.x > labelCell.x && valueMatches(c.text),
      );
      if (value) return value.text;
    }
  }
  return undefined;
}

function requireHeaderValue(
  pages: LayoutPage[],
  label: RegExp,
  valueMatches: (text: string) => boolean,
  fieldName: string,
): string {
  const value = findHeaderValue(pages, label, valueMatches);
  if (value === undefined) {
    throw new Error(`VIB parser: could not find "${fieldName}" in header`);
  }
  return value;
}

function isTableNoise(row: LayoutRow): boolean {
  return row.cells.some((cell) =>
    TABLE_NOISE.some((pattern) => pattern.test(cell.text)),
  );
}

/** True when the row opens a transaction: two leading DD/MM/YYYY cells. */
function isTransactionStart(row: LayoutRow): boolean {
  return (
    row.cells.length >= 2 &&
    isDdMmYyyy(row.cells[0].text) &&
    isDdMmYyyy(row.cells[1].text)
  );
}

/** Walk every page and collect the transaction rows, folding wrapped lines. */
function extractRows(pages: LayoutPage[]): VibRow[] {
  const rows: VibRow[] = [];
  let inTable = false;
  let current: VibRow | null = null;

  for (const page of pages) {
    for (const row of page.rows) {
      if (!inTable) {
        if (row.cells.some((c) => TABLE_START.test(c.text))) inTable = true;
        continue;
      }

      if (row.cells.some((c) => TABLE_END.test(c.text))) {
        current = null;
        inTable = false;
        break;
      }

      if (isTableNoise(row)) {
        current = null;
        continue;
      }

      if (isTransactionStart(row)) {
        const amountCell = [...row.cells]
          .reverse()
          .find((c) => c.x >= COL_AMOUNT_MIN && isVibAmount(c.text));
        if (!amountCell) {
          // A dated row with no amount is not a transaction we can use.
          current = null;
          continue;
        }
        const mccCell = row.cells.find(
          (c) => c.x >= COL_MCC_MIN && c.x < COL_AMOUNT_MIN,
        );
        const descriptionCells = row.cells.filter(
          (c) => c.x >= COL_DETAILS_MIN && c.x < COL_MCC_MIN,
        );
        current = {
          txnDate: row.cells[0].text,
          postDate: row.cells[1].text,
          descriptionParts: descriptionCells.map((c) => c.text),
          amountRaw: amountCell.text,
          mcc: mccCell?.text,
        };
        rows.push(current);
        continue;
      }

      // Continuation: a details-column-only row wraps the description above.
      const isContinuation =
        current !== null &&
        row.cells.length > 0 &&
        row.cells.every(
          (c) => c.x >= COL_DETAILS_MIN && c.x < COL_MCC_MIN,
        );
      if (isContinuation && current) {
        current.descriptionParts.push(...row.cells.map((c) => c.text));
      } else {
        current = null;
      }
    }
  }

  return rows;
}

/** Turn positioned rows into a validated Statement. */
export function parseVibStatementFromLayout(pages: LayoutPage[]): Statement {
  // --- Header ---
  const maskedCard = requireHeaderValue(
    pages,
    /\(Primary Card Number\)/,
    (t) => /\d{4}$/.test(t),
    'Primary Card Number',
  );
  const last4Match = maskedCard.match(/(\d{4})\D*$/);
  if (!last4Match) {
    throw new Error('VIB parser: could not derive cardLast4 from card number');
  }
  const cardLast4 = last4Match[1];

  const statementDate = toIsoDate(
    requireHeaderValue(pages, /\(Statement Date\)/, isDdMmYyyy, 'Statement Date'),
  );
  const paymentDueDate = toIsoDate(
    requireHeaderValue(
      pages,
      /\(Payment Due Date\)/,
      isDdMmYyyy,
      'Payment Due Date',
    ),
  );
  const creditLimit = parseVibAmount(
    requireHeaderValue(pages, /\(Credit Limit\)/, isVibAmount, 'Credit Limit'),
  );
  const previousBalance = parseVibAmount(
    requireHeaderValue(
      pages,
      /\(Previous Balance\)/,
      isVibAmount,
      'Previous Balance',
    ),
  );
  const statementBalance = parseVibAmount(
    requireHeaderValue(pages, /\(End Balance\)/, isVibAmount, 'End Balance'),
  );
  const minimumPayment = parseVibAmount(
    requireHeaderValue(
      pages,
      /\(Minimum Payment Due\)/,
      isVibAmount,
      'Minimum Payment Due',
    ),
  );
  const totalDebit = parseVibAmount(
    requireHeaderValue(
      pages,
      /\(Total Debit Transaction\)/,
      isVibAmount,
      'Total Debit Transaction',
    ),
  );

  // --- Transactions ---
  const transactions: Transaction[] = [];
  let totalSpend = 0;
  let totalInstallments = 0;
  let totalFeesAndInterest = 0;
  let totalCashback = 0;

  for (const row of extractRows(pages)) {
    const rawDescription = row.descriptionParts.join(' ');
    const description = scrubVibDescription(rawDescription);
    const amountVnd = parseVibAmount(row.amountRaw);
    const magnitude = Math.abs(amountVnd);

    const isInstallment = INSTALLMENT_RE.test(rawDescription);

    if (amountVnd < 0) {
      if (CASHBACK_RE.test(rawDescription)) totalCashback += magnitude;
    } else if (isInstallment) {
      totalInstallments += magnitude;
    } else if (FEE_RE.test(rawDescription)) {
      totalFeesAndInterest += magnitude;
    } else {
      totalSpend += magnitude;
    }

    transactions.push({
      date: toIsoDate(row.txnDate),
      postingDate: toIsoDate(row.postDate),
      description: normalizeMerchant(description),
      // VIB bills every row in VND. No foreign-currency sample exists yet.
      currency: 'VND',
      originalAmount: magnitude,
      amountVnd,
      category: categorize(description),
      isInstallment,
      isInternational: false,
    });
  }

  // The statement prints its own total-debit figure. If our per-row tally
  // disagrees, the layout has shifted and every number below is suspect —
  // fail loudly rather than storing a wrong statement.
  const tallied = totalSpend + totalInstallments + totalFeesAndInterest;
  if (tallied !== totalDebit) {
    throw new Error(
      `VIB parser: debit totals do not reconcile (rows total ${tallied}, statement says ${totalDebit})`,
    );
  }

  return StatementSchema.parse({
    bank: 'VIB',
    cardLast4,
    statementDate,
    paymentDueDate,
    creditLimit,
    totals: {
      previousBalance,
      statementBalance,
      minimumPayment,
      totalSpend,
      totalInstallments,
      totalCashback,
      totalFeesAndInterest,
    },
    transactions,
  } satisfies Statement);
}

export async function parseVIBStatement(
  buffer: Buffer,
  password?: string,
): Promise<Statement> {
  const pages = await extractPdfLayout(buffer, password);
  return parseVibStatementFromLayout(pages);
}
```

- [ ] **Step 5: Add the export subpath**

In `packages/domain/package.json`, add to `exports`:

```json
    "./parsers/vib": "./src/parsers/vib.ts",
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test lib/__tests__/vib.test.ts`
Expected: PASS. The synthetic-layout describe block runs everywhere; the fixture block runs locally and reports `skipped` in CI.

If the fixture block fails on a specific field, dump the real layout to compare against the synthetic rows:

```bash
pnpm tsx -e "
import { extractPdfLayout } from './packages/domain/src/parsers/pdf-layout';
import fs from 'fs';
const pages = await extractPdfLayout(fs.readFileSync('test-pdfs/vib_saoke_07_2026_4550.pdf'), '26034550');
for (const row of pages[0].rows) console.log(row.y, row.cells.map(c => '[' + c.x + ']' + c.text).join(' '));
"
```

- [ ] **Step 7: Add the VIB acceptance section to the parser script**

In `scripts/test-parser.ts`, add the import at the top:

```ts
import { parseVIBStatement } from '../packages/domain/src/parsers/vib';
```

and add this VIB block inside `main()`, after the existing TPBank checks and before the failure summary:

```ts
  const vibFixture = path.join(process.cwd(), 'test-pdfs', 'vib_saoke_07_2026_4550.pdf');
  if (existsSync(vibFixture)) {
    console.log('\n--- VIB (July 2026) ---');
    const vib = await parseVIBStatement(
      await fs.readFile(vibFixture),
      process.env.VIB_PDF_PASSWORD,
    );
    check('bank === "VIB"', vib.bank === 'VIB', vib.bank);
    check('cardLast4 === "4550"', vib.cardLast4 === '4550', vib.cardLast4);
    check(
      'statementDate === "2026-07-25"',
      vib.statementDate === '2026-07-25',
      vib.statementDate,
    );
    check(
      'paymentDueDate === "2026-08-10"',
      vib.paymentDueDate === '2026-08-10',
      vib.paymentDueDate,
    );
    check(
      'creditLimit === 124000000',
      vib.creditLimit === 124_000_000,
      String(vib.creditLimit),
    );
    check(
      'statementBalance === 5591567',
      vib.totals.statementBalance === 5_591_567,
      String(vib.totals.statementBalance),
    );
    check(
      'minimumPayment === 5582360',
      vib.totals.minimumPayment === 5_582_360,
      String(vib.totals.minimumPayment),
    );
    check('totalSpend === 0', vib.totals.totalSpend === 0, String(vib.totals.totalSpend));
    check(
      'totalInstallments === 5581667',
      vib.totals.totalInstallments === 5_581_667,
      String(vib.totals.totalInstallments),
    );
    check(
      'totalFeesAndInterest === 9900',
      vib.totals.totalFeesAndInterest === 9_900,
      String(vib.totals.totalFeesAndInterest),
    );
    check(
      'transactions.length === 3',
      vib.transactions.length === 3,
      String(vib.transactions.length),
    );
    check(
      'no PAN or cardholder name in output',
      !/\d{6}[x*]{6}\d{4}/i.test(JSON.stringify(vib)) &&
        !JSON.stringify(vib).includes('NGUYEN'),
    );
  } else {
    console.log('\n--- VIB: fixture absent, skipped ---');
  }
```

Add `import { existsSync } from 'fs';` at the top if it is not already imported.

- [ ] **Step 8: Run the parser script**

```bash
VIB_PDF_PASSWORD=26034550 pnpm tsx scripts/test-parser.ts
```

Expected: every TPBank check still passes (regression guard) and every VIB check passes.

- [ ] **Step 9: Extend the privacy invariant test**

In `lib/__tests__/architecture-privacy.test.ts`, add this test inside the existing `describe('hybrid architecture privacy boundaries', …)` block:

```ts
  it('scrubs PAN, account number, and cardholder name out of VIB descriptions', () => {
    const raw =
      '526887xxxxxx4550-000000000786286 - NGUYEN GIA HUY - Thanh toan sao ke the Master Card 06/2026';
    const scrubbed = scrubVibDescription(raw);
    expect(scrubbed).not.toMatch(/\d{6}[x*]{6}\d{4}/i);
    expect(scrubbed).not.toMatch(/\b\d{9,}\b/);
    expect(scrubbed).not.toContain('NGUYEN');
  });
```

and add the import at the top of that file:

```ts
import { scrubVibDescription } from '@cashight/domain/parsers/vib-fields';
```

- [ ] **Step 10: Run the full suite**

Run: `pnpm test && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/domain/src/parsers/vib.ts packages/domain/package.json \
  lib/__tests__/vib.test.ts lib/__tests__/architecture-privacy.test.ts \
  scripts/test-parser.ts
git commit -m "feat: add the VIB statement parser"
```

---

### Task 5: Split TPBank text extraction from parsing

Prepares the TPBank parser to accept text the dispatcher has already extracted, so a PDF is only text-extracted once. **No behaviour change.**

**Files:**
- Create: `packages/domain/src/parsers/pdf-text.ts`
- Modify: `packages/domain/src/parsers/tpbank.ts:198-228` (extraction helper and entry point)
- Modify: `packages/domain/package.json` (exports map)

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ExtractedPdfText { text: string; password?: string }`, `extractPdfText(buffer: Buffer, passwords: string[]): Promise<ExtractedPdfText>`, `parseTPBankStatementFromText(text: string): Statement` (the existing `parseTPBankStatement(buffer, password?)` signature is preserved).

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/tpbank.test.ts`:

```ts
describe('parseTPBankStatementFromText', () => {
  it('is exported and rejects text that is not a TPBank statement', async () => {
    const { parseTPBankStatementFromText } = await import(
      '@cashight/domain/parsers/tpbank'
    );
    expect(() => parseTPBankStatementFromText('not a statement')).toThrow(
      /could not find/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/__tests__/tpbank.test.ts`
Expected: FAIL — `parseTPBankStatementFromText is not a function`.

- [ ] **Step 3: Create the shared text extractor**

Create `packages/domain/src/parsers/pdf-text.ts`:

```ts
/**
 * Plain-text PDF extraction shared by bank detection and the TPBank parser.
 *
 * Tries the document unprotected first, then each candidate password in order.
 * Candidates come from the PDF password secret, which holds one password per
 * supported bank; the bank cannot be known before the document is decrypted,
 * so every candidate is tried rather than selected.
 *
 * Passwords are never logged.
 */

// MUST precede the `pdf-parse` import — see ../pdf-dom-polyfill.ts.
import '../pdf-dom-polyfill';
import { PDFParse } from 'pdf-parse';

export interface ExtractedPdfText {
  text: string;
  /** The password that worked, or undefined when none was needed. */
  password?: string;
}

function isPasswordException(err: unknown): boolean {
  return err instanceof Error && err.name === 'PasswordException';
}

/**
 * Extract raw text once.
 *
 * A fresh Uint8Array is allocated per attempt on purpose: pdf.js TRANSFERS the
 * typed array to its worker and detaches it, so one array cannot be reused
 * across two PDFParse instances.
 */
async function extractOnce(buffer: Buffer, password?: string): Promise<string> {
  const data = new Uint8Array(buffer);
  const parser = new PDFParse(password ? { data, password } : { data });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export async function extractPdfText(
  buffer: Buffer,
  passwords: string[] = [],
): Promise<ExtractedPdfText> {
  try {
    return { text: await extractOnce(buffer) };
  } catch (err) {
    if (!isPasswordException(err)) throw err;

    let lastError = err;
    for (const password of passwords) {
      if (!password) continue;
      try {
        return { text: await extractOnce(buffer, password), password };
      } catch (retryError) {
        if (!isPasswordException(retryError)) throw retryError;
        lastError = retryError;
      }
    }
    throw lastError;
  }
}
```

- [ ] **Step 4: Rewire the TPBank parser**

In `packages/domain/src/parsers/tpbank.ts`:

1. Delete the local `extractText` function (lines 198-216) and the `import { PDFParse } from 'pdf-parse';` line. Keep the `import '../pdf-dom-polyfill';` line — it is still the first import in the file.
2. Add after the polyfill import:

```ts
import { extractPdfText } from './pdf-text';
```

3. Replace the `export async function parseTPBankStatement(...)` signature and its extraction preamble (lines 218-228) with:

```ts
/**
 * Parse a TPBank statement from already-extracted PDF text. The dispatcher
 * extracts once, detects the bank, then calls this — no second extraction.
 */
export function parseTPBankStatementFromText(text: string): Statement {
```

4. Delete the `let text: string; try { … } catch { … }` block that followed, so the function body starts directly at the existing `// --- PCI: mask the PAN immediately … ---` comment.
5. Append a buffer-taking wrapper at the end of the file, preserving the original public signature:

```ts
/**
 * Parse a TPBank statement straight from a PDF buffer. Retained for the
 * verification script and the fixture tests; the upload path goes through
 * `parseStatementPdf` in ./index.ts instead.
 */
export async function parseTPBankStatement(
  buffer: Buffer,
  password?: string,
): Promise<Statement> {
  const { text } = await extractPdfText(buffer, password ? [password] : []);
  return parseTPBankStatementFromText(text);
}
```

- [ ] **Step 5: Add the export subpath**

In `packages/domain/package.json`, add to `exports`:

```json
    "./parsers/pdf-text": "./src/parsers/pdf-text.ts",
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm test lib/__tests__/tpbank.test.ts
pnpm tsx scripts/test-parser.ts
```

Expected: every existing TPBank acceptance number still passes — `statementBalance 37978402`, `totalSpend 26986712`, `totalCashback 519020`, `totalInstallments 10749850`, `totalFeesAndInterest 760860`, 41 transactions, `cardLast4 '9674'`. This is the regression gate for the split.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/parsers/pdf-text.ts packages/domain/src/parsers/tpbank.ts \
  packages/domain/package.json lib/__tests__/tpbank.test.ts
git commit -m "refactor: split TPBank text extraction from parsing"
```

---

### Task 6: Parse dispatcher

**Files:**
- Create: `packages/domain/src/parsers/index.ts`
- Create: `lib/__tests__/parse-dispatch.test.ts`
- Modify: `packages/domain/package.json` (exports map)

**Interfaces:**
- Consumes: `detectBank` (Task 1), `extractPdfText` + `parseTPBankStatementFromText` (Task 5), `parseVIBStatement` (Task 4).
- Produces: `class UnsupportedBankError extends Error` (with `name === 'UnsupportedBankError'`), `parseStatementPdf(buffer: Buffer, passwords?: string[]): Promise<Statement>`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/parse-dispatch.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  UnsupportedBankError,
  parseStatementPdf,
} from '@cashight/domain/parsers';

const tpbPath = path.resolve(
  __dirname,
  '../../test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf',
);
const vibPath = path.resolve(__dirname, '../../test-pdfs/vib_saoke_07_2026_4550.pdf');

describe('UnsupportedBankError', () => {
  it('carries a stable name so callers can branch on it', () => {
    expect(new UnsupportedBankError().name).toBe('UnsupportedBankError');
  });
});

describe('parseStatementPdf', () => {
  it('rejects a non-statement PDF with UnsupportedBankError', async () => {
    // A minimal one-page PDF containing the word "Hello".
    const minimalPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 20 100 Td (Hello) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>',
      'latin1',
    );
    await expect(parseStatementPdf(minimalPdf, [])).rejects.toThrow(
      UnsupportedBankError,
    );
  });

  it.skipIf(!fs.existsSync(tpbPath))('routes a TPBank PDF to the TPBank parser', async () => {
    const stmt = await parseStatementPdf(fs.readFileSync(tpbPath), []);
    expect(stmt.bank).toBe('TPBank');
    expect(stmt.cardLast4).toBe('9674');
  });

  it.skipIf(!fs.existsSync(vibPath))('routes a VIB PDF to the VIB parser using a candidate password', async () => {
    const stmt = await parseStatementPdf(fs.readFileSync(vibPath), [
      'wrong-password',
      '26034550',
    ]);
    expect(stmt.bank).toBe('VIB');
    expect(stmt.cardLast4).toBe('4550');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/__tests__/parse-dispatch.test.ts`
Expected: FAIL — cannot resolve `@cashight/domain/parsers`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/parsers/index.ts`:

```ts
/**
 * Entry point for the upload parse path: extract text once, identify the bank,
 * route to that bank's parser.
 *
 * The VIB parser re-opens the PDF to read coordinates. That second pass is
 * deliberate — it keeps the TPBank parser on exactly the `pdf-parse` text it
 * was verified against, and the working password is threaded through so the
 * candidate list is not retried.
 */

import { detectBank } from '../banks';
import type { Statement } from '../schemas';
import { extractPdfText } from './pdf-text';
import { parseTPBankStatementFromText } from './tpbank';
import { parseVIBStatement } from './vib';

export class UnsupportedBankError extends Error {
  constructor() {
    super('Unrecognised statement — no supported bank matched');
    this.name = 'UnsupportedBankError';
  }
}

export async function parseStatementPdf(
  buffer: Buffer,
  passwords: string[] = [],
): Promise<Statement> {
  const { text, password } = await extractPdfText(buffer, passwords);
  const bank = detectBank(text);

  switch (bank) {
    case 'TPBank':
      return parseTPBankStatementFromText(text);
    case 'VIB':
      return parseVIBStatement(buffer, password);
    default:
      throw new UnsupportedBankError();
  }
}
```

- [ ] **Step 4: Add the export subpath**

In `packages/domain/package.json`, add to `exports`:

```json
    "./parsers": "./src/parsers/index.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test lib/__tests__/parse-dispatch.test.ts`
Expected: PASS (fixture-gated cases run locally, skip in CI).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/parsers/index.ts packages/domain/package.json \
  lib/__tests__/parse-dispatch.test.ts
git commit -m "feat: route uploads to a parser by detected bank"
```

---

### Task 7: Backend wiring — password list, dispatcher, error code, metadata

**Files:**
- Create: `backend/shared/pdf-passwords.ts`
- Create: `backend/__tests__/pdf-passwords.test.ts`
- Modify: `backend/shared/metadata.ts:23-34` and `:44-55` (record type + schema)
- Modify: `backend/functions/parser-worker/process-job.ts:25` (`parsePdf` dep), `:40-47` (error predicates), `:110-127` (parse block), `:28-35` (`writeMetadata` params)
- Modify: `backend/functions/parser-worker/handler.ts:2` (import), `:95` (`parsePdf`), `:117-132` (`writeMetadata`)
- Modify: `scripts/local/handlers.ts:1`, `:208`, `:210`

**Interfaces:**
- Consumes: `parseStatementPdf`, `UnsupportedBankError` (Task 6); `BankCode` (Task 1).
- Produces: `parsePdfPasswords(secretString: string): string[]`; `StatementMetadataRecord.bank?: BankCode`; `ProcessJobDependencies.parsePdf: (buffer: Buffer, passwords: string[]) => Promise<Statement>`; error code `'UNSUPPORTED_BANK'`.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/pdf-passwords.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parsePdfPasswords } from '../shared/pdf-passwords';

describe('parsePdfPasswords', () => {
  it('returns an empty list for an empty secret', () => {
    expect(parsePdfPasswords('')).toEqual([]);
    expect(parsePdfPasswords('   ')).toEqual([]);
  });

  it('treats a plain string as a single password (legacy secret shape)', () => {
    expect(parsePdfPasswords('hunter2')).toEqual(['hunter2']);
  });

  it('returns the values of a JSON map in declaration order', () => {
    expect(parsePdfPasswords('{"TPB":"aaa","VIB":"bbb"}')).toEqual(['aaa', 'bbb']);
  });

  it('drops empty and non-string values from the map', () => {
    expect(parsePdfPasswords('{"TPB":"aaa","VIB":"","X":3}')).toEqual(['aaa']);
  });

  it('falls back to treating malformed JSON as a single password', () => {
    expect(parsePdfPasswords('{not json')).toEqual(['{not json']);
  });

  it('deduplicates repeated passwords', () => {
    expect(parsePdfPasswords('{"A":"same","B":"same"}')).toEqual(['same']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test backend/__tests__/pdf-passwords.test.ts`
Expected: FAIL — cannot find `../shared/pdf-passwords`.

- [ ] **Step 3: Write the implementation**

Create `backend/shared/pdf-passwords.ts`. It deliberately imports nothing — `process-job` tests must stay dependency-free unit tests.

```ts
/**
 * Interpret the PDF password secret.
 *
 * Two shapes are accepted so a deploy and a secret rotation do not have to be
 * simultaneous:
 *   - a plain string  -> one candidate password (the original shape)
 *   - a JSON object   -> its values, in declaration order
 *
 * The JSON keys are human labels only. Passwords cannot be selected by bank
 * because the PDF must be decrypted before its bank can be detected, so every
 * candidate is tried in turn.
 *
 * Never log the input or the output of this function.
 */
export function parsePdfPasswords(secretString: string): string[] {
  const trimmed = secretString.trim();
  if (trimmed === '') return [];

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const values = Object.values(parsed as Record<string, unknown>).filter(
          (value): value is string => typeof value === 'string' && value !== '',
        );
        return [...new Set(values)];
      }
    } catch {
      // Not JSON after all — fall through and treat it as a single password.
    }
  }

  return [trimmed];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test backend/__tests__/pdf-passwords.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add `bank` to the statement metadata record**

In `backend/shared/metadata.ts`:

1. Add the import beside the other domain imports:

```ts
import { BANK_CODES, type BankCode } from '@cashight/domain/banks';
```

2. In `interface StatementMetadataRecord`, add after `cardLast4`:

```ts
  /** Absent on records written before multi-bank support — read as 'TPBank'. */
  bank?: BankCode;
```

3. In `statementMetadataRecordSchema`, add after the `cardLast4` line:

```ts
  bank: z.enum(BANK_CODES).optional(),
```

- [ ] **Step 6: Write the failing process-job test**

Append to `backend/__tests__/parser-worker.test.ts` — follow the existing dependency-stub style in that file for `createProcessJob`, reusing whatever helper it already defines to build a full `ProcessJobDependencies` object:

```ts
  it('fails the job with UNSUPPORTED_BANK when no parser matches', async () => {
    const transitions: Array<{ state: string; extra?: { errorCode?: string } }> = [];
    const deps = makeDeps({
      parsePdf: async () => {
        const err = new Error('Unrecognised statement');
        err.name = 'UnsupportedBankError';
        throw err;
      },
      transitionToTerminal: async (_jobId, state, extra) => {
        transitions.push({ state, extra });
      },
    });

    await createProcessJob(deps)('uploads/user-1/job-1.pdf');

    expect(transitions).toContainEqual(
      expect.objectContaining({
        state: 'FAILED',
        extra: expect.objectContaining({ errorCode: 'UNSUPPORTED_BANK' }),
      }),
    );
  });

  it('writes the statement bank into the metadata record', async () => {
    let written: { bank?: string } | undefined;
    const deps = makeDeps({
      writeMetadata: async (params) => {
        written = { bank: params.statement.bank };
      },
    });

    await createProcessJob(deps)('uploads/user-1/job-1.pdf');

    expect(written?.bank).toBe('TPBank');
  });
```

If `backend/__tests__/parser-worker.test.ts` has no `makeDeps` helper, extract one from the existing tests first so both new tests and the old ones share it.

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm test backend/__tests__/parser-worker.test.ts`
Expected: FAIL — the job is marked `FAILED` with `PARSE_ERROR`, not `UNSUPPORTED_BANK`.

- [ ] **Step 8: Update `process-job.ts`**

1. Add the imports:

```ts
import { parsePdfPasswords } from '../../shared/pdf-passwords';
```

2. Change the `parsePdf` dependency type (line 25) from:

```ts
  parsePdf: (buffer: Buffer, password?: string) => Promise<Statement>;
```

to:

```ts
  parsePdf: (buffer: Buffer, passwords: string[]) => Promise<Statement>;
```

3. Add an error predicate beside `isPasswordError`:

```ts
function isUnsupportedBankError(err: unknown): boolean {
  return err instanceof Error && err.name === 'UnsupportedBankError';
}
```

4. Replace the parse block (lines 110-127) with:

```ts
    // Parse PDF
    let statement: Statement;
    try {
      const secret = await deps.getSecret(process.env.PDF_PASSWORD_SECRET_ID ?? '');
      const passwords = parsePdfPasswords(secret);
      const rawStatement = await deps.parsePdf(pdfBuffer, passwords);
      // Validate with Zod
      statement = StatementSchema.parse(rawStatement);
    } catch (err) {
      // Checked before the password branch: an unsupported-bank error can carry
      // a message that mentions neither passwords nor encryption.
      if (isUnsupportedBankError(err)) {
        await deps.transitionToTerminal(jobId, 'FAILED', {
          errorCode: 'UNSUPPORTED_BANK',
        });
        await deps.deletePdf(s3Key);
        return;
      }
      if (isPasswordError(err)) {
        await deps.transitionToTerminal(jobId, 'FAILED', { errorCode: 'WRONG_PASSWORD' });
        await deps.deletePdf(s3Key);
        return;
      }
      // Schema or other parse failure
      await deps.transitionToTerminal(jobId, 'FAILED', { errorCode: 'PARSE_ERROR' });
      await deps.deletePdf(s3Key);
      return;
    }
```

- [ ] **Step 9: Update `parser-worker/handler.ts`**

1. Replace the parser import (line 2):

```ts
import { parseStatementPdf } from '@cashight/domain/parsers';
```

2. Replace the `parsePdf` dependency (line 95):

```ts
    parsePdf: (buffer, passwords) => parseStatementPdf(buffer, passwords),
```

3. In `writeMetadata` (lines 117-132), add `bank` to the record, immediately after `cardLast4`:

```ts
        bank: statement.bank,
```

- [ ] **Step 10: Update the local dev stack**

In `scripts/local/handlers.ts`:

1. Replace the parser import (line 1):

```ts
import { parseStatementPdf } from '@cashight/domain/parsers';
```

2. Replace the secret and parser dependencies (lines 208 and 210):

```ts
  getSecret: async () => process.env.PDF_PASSWORDS ?? process.env.PDF_PASSWORD ?? '',
  // …
  parsePdf: (buffer, passwords) => parseStatementPdf(buffer, passwords),
```

3. If the local stack builds a statement metadata record of its own, add `bank: statement.bank` there too. Search with `grep -n "cardLast4" scripts/local/handlers.ts` and mirror the production handler.

- [ ] **Step 11: Run tests to verify they pass**

```bash
pnpm test backend/__tests__/
pnpm test
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 12: Verify the Lambda bundle**

```bash
pnpm build:lambdas && ls dist/lambdas/parser-worker/
```

Expected: `index.js` and `pdf.worker.mjs` present. The worker file is required at runtime by the bundled `pdfjs-dist`.

- [ ] **Step 13: Commit**

```bash
git add backend/shared/pdf-passwords.ts backend/shared/metadata.ts \
  backend/functions/parser-worker/ backend/__tests__/ scripts/local/handlers.ts
git commit -m "feat: parse uploads by detected bank with a password candidate list"
```

---

### Task 8: Bank on the statements list

**Files:**
- Modify: `backend/functions/statements-api/handler.ts:53-62` (`metaToSummary`)
- Modify: `frontend/api/contracts.ts:43-51` (`StatementListItemSchema`)
- Modify: `frontend/hooks/use-statements.ts:13-28` (`toStatementRow`)
- Modify: `app/components/statements-table.tsx:33-40` (`StatementRow`) and the table markup
- Modify: `backend/__tests__/statements-api.test.ts`

**Interfaces:**
- Consumes: `BankCode`, `bankShortName` (Task 1); `StatementMetadataRecord.bank` (Task 7).
- Produces: `StatementListItem.bank: BankCode`; `StatementRow.bank: BankCode`.

- [ ] **Step 1: Write the failing test**

Append to `backend/__tests__/statements-api.test.ts`, following the existing handler-test style in that file:

```ts
  it('reports the bank on each list item, defaulting legacy records to TPBank', async () => {
    const handler = createStatementsApiHandler({
      ...baseDeps,
      queryStatements: async () => ({
        items: [
          { ...metadataFixture, statementId: '2026-07-4550', cardLast4: '4550', bank: 'VIB' },
          { ...metadataFixture, statementId: '2026-05-9674', cardLast4: '9674' },
        ],
        nextCursor: null,
      }),
    });

    const response = await handler(listEvent);
    const body = JSON.parse(response.body);

    expect(body.items[0].bank).toBe('VIB');
    expect(body.items[1].bank).toBe('TPBank');
  });
```

Reuse whatever names that file already uses for `baseDeps`, `metadataFixture` and the list event; if it builds them inline, extract them into shared consts first.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test backend/__tests__/statements-api.test.ts`
Expected: FAIL — `body.items[0].bank` is `undefined`.

- [ ] **Step 3: Emit the bank from the API**

In `backend/functions/statements-api/handler.ts`, add to `metaToSummary` after `cardLast4`:

```ts
    bank: record.bank ?? 'TPBank',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test backend/__tests__/statements-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the field to the client contract**

In `frontend/api/contracts.ts`:

1. Add the import at the top:

```ts
import { BANK_CODES } from '@cashight/domain/banks';
```

2. In `StatementListItemSchema`, add after `cardLast4`:

```ts
  // Older API responses omit this; every pre-VIB statement is a TPBank one.
  bank: z.enum(BANK_CODES).default('TPBank'),
```

- [ ] **Step 6: Carry the bank into the table row**

In `app/components/statements-table.tsx`, add to `StatementRow` after `cardLast4`:

```ts
  bank: BankCode;
```

and add the import:

```ts
import { bankShortName, type BankCode } from '@/lib/banks';
```

Add a Bank column to the table. In the header row, insert a `<TableHead>` immediately before the existing card column:

```tsx
              <TableHead className="text-gray-500 dark:text-gray-400">Bank</TableHead>
```

and in the body row, the matching cell in the same position:

```tsx
                <TableCell>
                  <Badge variant="outline">{bankShortName(row.bank)}</Badge>
                </TableCell>
```

Match the `variant` and class names of the neighbouring cells — read the surrounding markup and keep it consistent rather than copying these verbatim if they differ.

- [ ] **Step 7: Map the field in the hook**

In `frontend/hooks/use-statements.ts`, extend `toStatementRow`'s parameter type with `bank: BankCode;` and add `bank: item.bank,` to the returned object. Add:

```ts
import type { BankCode } from '@/lib/banks';
```

- [ ] **Step 8: Run the suite and type check**

```bash
pnpm test && pnpm tsc --noEmit && pnpm lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/functions/statements-api/handler.ts backend/__tests__/statements-api.test.ts \
  frontend/api/contracts.ts frontend/hooks/use-statements.ts \
  app/components/statements-table.tsx
git commit -m "feat: show the issuing bank in the statements list"
```

---

### Task 9: Bank filter in the aggregation engine

**Files:**
- Modify: `packages/domain/src/aggregations.ts:18-71` (`AggregatedView`) and `:229-279` (`aggregate`)
- Modify: `packages/domain/src/schemas.ts:54-102` (`AggregatedViewSchema`)
- Modify: `lib/__tests__/aggregations.test.ts`

**Interfaces:**
- Consumes: `BankCode`, `BANK_CODES` (Task 1).
- Produces: `interface AggregateOptions { bank?: BankCode | null }`, `aggregate(statements: Statement[], spec: PeriodSpec, options?: AggregateOptions): AggregatedView`, `AggregatedView.availableBanks?: BankCode[]`.

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/aggregations.test.ts`. Reuse the file's existing statement-fixture helper; if it builds statements inline, add this local helper first:

```ts
function statementFor(bank: 'TPBank' | 'VIB', cardLast4: string, spend: number) {
  return StatementSchema.parse({
    bank,
    cardLast4,
    statementDate: '2026-07-25',
    paymentDueDate: '2026-08-10',
    creditLimit: 100_000_000,
    totals: {
      previousBalance: 0,
      statementBalance: spend,
      minimumPayment: 0,
      totalSpend: spend,
      totalInstallments: 0,
      totalCashback: 0,
      totalFeesAndInterest: 0,
    },
    transactions: [],
  });
}

describe('aggregate — bank filter', () => {
  const spec = { type: 'month', year: 2026, month: 7 } as const;
  const statements = [
    statementFor('TPBank', '9674', 1_000_000),
    statementFor('VIB', '4550', 250_000),
  ];

  it('includes every bank when no filter is given', () => {
    const view = aggregate(statements, spec);
    expect(view.statementCount).toBe(2);
    expect(view.totals.totalSpend).toBe(1_250_000);
  });

  it('narrows totals to the selected bank', () => {
    const view = aggregate(statements, spec, { bank: 'VIB' });
    expect(view.statementCount).toBe(1);
    expect(view.totals.totalSpend).toBe(250_000);
  });

  it('lists the banks present in the period regardless of the filter', () => {
    const view = aggregate(statements, spec, { bank: 'VIB' });
    expect(view.availableBanks).toEqual(['TPBank', 'VIB']);
  });

  it('lists no banks for an empty period', () => {
    const view = aggregate(statements, { type: 'month', year: 2026, month: 1 });
    expect(view.availableBanks).toEqual([]);
  });

  it('treats a null bank as no filter', () => {
    expect(aggregate(statements, spec, { bank: null }).statementCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/__tests__/aggregations.test.ts`
Expected: FAIL — `aggregate` takes two arguments and `availableBanks` is undefined.

- [ ] **Step 3: Update `AggregatedView` and `aggregate`**

In `packages/domain/src/aggregations.ts`:

1. Add the import:

```ts
import type { BankCode } from './banks';
```

2. Add to the `AggregatedView` interface, after `statementCount`:

```ts
  /**
   * Banks with a statement in this period, BEFORE the bank filter is applied —
   * this is what populates the dashboard dropdown, so filtering to one bank
   * must not make the others disappear from the list.
   *
   * Optional for the same reason as `latestStatement`: a cached SPA bundle
   * posting the older shape to /summaries must still validate.
   */
  availableBanks?: BankCode[];
```

3. Add the options interface above `aggregate`:

```ts
export interface AggregateOptions {
  /** Narrow the view to one bank. Null/undefined means all banks. */
  bank?: BankCode | null;
}
```

4. Change the `aggregate` signature and its first lines from:

```ts
export function aggregate(
  statements: Statement[],
  spec: PeriodSpec,
): AggregatedView {
  const filtered = filterStatements(statements, spec);
```

to:

```ts
export function aggregate(
  statements: Statement[],
  spec: PeriodSpec,
  options: AggregateOptions = {},
): AggregatedView {
  const inPeriod = filterStatements(statements, spec);
  const availableBanks = [...new Set(inPeriod.map((s) => s.bank))].sort();
  const filtered = options.bank
    ? inPeriod.filter((s) => s.bank === options.bank)
    : inPeriod;
```

5. Add `availableBanks,` to the returned object, immediately after `statementCount: filtered.length,`.

- [ ] **Step 4: Mirror the field in the boundary schema**

In `packages/domain/src/schemas.ts`, add to `AggregatedViewSchema` after `statementCount`:

```ts
  // Optional for the same reason as `latestStatement` below — a cached SPA
  // bundle posting the older shape to /summaries must still validate.
  availableBanks: z.array(z.enum(BANK_CODES)).optional(),
```

(`BANK_CODES` is already imported in this file from Task 1.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test lib/__tests__/aggregations.test.ts
pnpm test && pnpm tsc --noEmit
```

Expected: PASS. The `satisfies z.ZodType<AggregatedView>` assertion at the bottom of `schemas.ts` is the guard that the interface and the schema agree — a type error there means the two definitions drifted.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/aggregations.ts packages/domain/src/schemas.ts \
  lib/__tests__/aggregations.test.ts
git commit -m "feat: filter aggregated views by bank"
```

---

### Task 10: Dashboard API and hook carry the bank

**Files:**
- Modify: `backend/functions/dashboard-api/handler.ts:58-72`
- Modify: `frontend/hooks/use-dashboard.ts` (whole file)
- Modify: `backend/__tests__/dashboard-api.test.ts`

**Interfaces:**
- Consumes: `parseBankFromSearch` (Task 1); `aggregate(statements, spec, options)` (Task 9).
- Produces: `useDashboard(spec: PeriodSpec | null, bank: BankCode | null)` — note the new second parameter, required by `app/page.tsx` in Task 11.

- [ ] **Step 1: Write the failing test**

Append to `backend/__tests__/dashboard-api.test.ts`, reusing the file's existing dependency stubs:

```ts
  it('narrows the view to the requested bank', async () => {
    const handler = createDashboardApiHandler({
      ...baseDeps,
      queryStatementsForYear: async () => [tpbMeta, vibMeta],
      getStatementObject: async (key) =>
        key === tpbMeta.objectKey ? tpbStatement : vibStatement,
    });

    const response = await handler({
      ...authorizedEvent,
      queryStringParameters: { period: 'month', year: '2026', month: '7', bank: 'VIB' },
    });
    const body = JSON.parse(response.body);

    expect(body.statementCount).toBe(1);
    expect(body.availableBanks).toEqual(['TPBank', 'VIB']);
  });

  it('includes every bank when no bank param is given', async () => {
    const handler = createDashboardApiHandler({
      ...baseDeps,
      queryStatementsForYear: async () => [tpbMeta, vibMeta],
      getStatementObject: async (key) =>
        key === tpbMeta.objectKey ? tpbStatement : vibStatement,
    });

    const response = await handler({
      ...authorizedEvent,
      queryStringParameters: { period: 'month', year: '2026', month: '7' },
    });

    expect(JSON.parse(response.body).statementCount).toBe(2);
  });
```

Define `tpbMeta` / `vibMeta` / `tpbStatement` / `vibStatement` alongside the file's existing fixtures — both statements dated `2026-07-25`, differing only in `bank` and `cardLast4` (`'9674'` / `'4550'`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test backend/__tests__/dashboard-api.test.ts`
Expected: FAIL — `statementCount` is 2 for the filtered request.

- [ ] **Step 3: Forward the param in the handler**

In `backend/functions/dashboard-api/handler.ts`:

1. Add to the domain imports:

```ts
import { parseBankFromSearch } from '@cashight/domain/banks';
```

2. Replace the spec/aggregate lines:

```ts
      const searchParams = buildSearchParams(event);
      const spec = parsePeriodFromSearch(searchParams);
      const bank = parseBankFromSearch(searchParams);
```

and:

```ts
      const view: AggregatedView = aggregate(statements, spec, { bank });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test backend/__tests__/dashboard-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread the bank through the hook**

In `frontend/hooks/use-dashboard.ts`:

1. Add the import:

```ts
import type { BankCode } from '@/lib/banks';
```

2. Change `buildPeriodParams` to take the bank as well and rename it:

```ts
function buildDashboardParams(
  spec: PeriodSpec,
  bank: BankCode | null,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('period', spec.type);
  params.set('year', String(spec.year));
  if (spec.type === 'month') params.set('month', String(spec.month));
  if (spec.type === 'quarter') params.set('quarter', String(spec.quarter));
  if (bank) params.set('bank', bank);
  return params;
}
```

3. Change the hook signature:

```ts
export function useDashboard(
  spec: PeriodSpec | null,
  bank: BankCode | null = null,
): {
```

4. Rename the request key so the bank is part of it — the whole point is that changing bank refetches:

```ts
  // Stable string key for the current request. `bank` is included so switching
  // banks refetches rather than reusing the previous view.
  const requestKey = spec ? JSON.stringify({ spec, bank }) : null;
```

Then rename every remaining use of `specKey` in the file to `requestKey` (the `LoadedState.specKey` field, the `loading` derivation, both `setLoaded` calls, the `isCurrent` comparison, and the effect's dependency array), and change the effect's guard and fetch to:

```ts
    if (!requestKey || !spec) return;
    // …
    const params = buildDashboardParams(spec, bank);
```

Keep the existing eslint-disable comment on the dependency array and update its wording to `requestKey encodes spec and bank`.

- [ ] **Step 6: Type check**

Run: `pnpm tsc --noEmit`
Expected: FAIL only in `app/page.tsx`, which still calls `useDashboard` with one argument — Task 11 fixes that. If you prefer a green tree at every commit, the default `bank: BankCode | null = null` parameter above already keeps the one-argument call valid; confirm the error list is empty.

- [ ] **Step 7: Run the suite**

```bash
pnpm test && pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/functions/dashboard-api/handler.ts backend/__tests__/dashboard-api.test.ts \
  frontend/hooks/use-dashboard.ts
git commit -m "feat: carry the bank filter through the dashboard API and hook"
```

---

### Task 11: Bank dropdown on the dashboard

**Files:**
- Create: `components/ui/select.tsx`
- Create: `app/components/bank-selector.tsx`
- Create: `app/__tests__/bank-selector.test.tsx`
- Modify: `app/page.tsx:33-100` (read the param, render the selector, pass the bank to the hook)

**Interfaces:**
- Consumes: `BankCode`, `bankShortName`, `parseBankFromSearch` (Task 1); `AggregatedView.availableBanks` (Task 9); `useDashboard(spec, bank)` (Task 10).
- Produces: `<BankSelector current={BankCode | null} available={BankCode[]} />`.

- [ ] **Step 1: Add the Radix Select primitive**

No select primitive exists yet. Create `components/ui/select.tsx`, matching the double-quote / `data-slot` house style of `components/ui/tabs.tsx`:

```tsx
"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-theme-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 sm:w-auto",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-60" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          "relative z-50 min-w-[8rem] overflow-hidden rounded-lg border border-gray-200 bg-white text-gray-700 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300",
          className
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-white/[0.06]",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
```

- [ ] **Step 2: Write the failing test**

Create `app/__tests__/bank-selector.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BankSelector } from '@/app/components/bank-selector';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('period=month&year=2026&month=7'),
}));

describe('BankSelector', () => {
  it('shows "All banks" when nothing is selected', () => {
    render(<BankSelector current={null} available={['TPBank', 'VIB']} />);
    expect(screen.getByText('All banks')).toBeInTheDocument();
  });

  it('shows the short name of the selected bank', () => {
    render(<BankSelector current={'TPBank'} available={['TPBank', 'VIB']} />);
    expect(screen.getByText('TPB')).toBeInTheDocument();
  });

  it('is labelled for assistive technology', () => {
    render(<BankSelector current={null} available={['VIB']} />);
    expect(screen.getByLabelText('Filter by bank')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test app/__tests__/bank-selector.test.tsx`
Expected: FAIL — cannot resolve `@/app/components/bank-selector`.

- [ ] **Step 4: Write the component**

Create `app/components/bank-selector.tsx`:

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { bankShortName, type BankCode } from '@/lib/banks';

/** Sentinel for "no filter" — Radix Select cannot hold an empty string value. */
const ALL = 'all';

export function BankSelector({
  current,
  available,
}: {
  current: BankCode | null;
  available: BankCode[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setBank(value: string) {
    // Preserve the period params — only the bank changes.
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL) {
      params.delete('bank');
    } else {
      params.set('bank', value);
    }
    router.push(`/?${params}`);
  }

  return (
    <Select value={current ?? ALL} onValueChange={setBank}>
      <SelectTrigger aria-label="Filter by bank" className="min-w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All banks</SelectItem>
        {available.map((code) => (
          <SelectItem key={code} value={code}>
            {bankShortName(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test app/__tests__/bank-selector.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Wire it into the dashboard page**

In `app/page.tsx`:

1. Add the imports:

```ts
import { parseBankFromSearch } from '@/lib/banks';
import { BankSelector } from '@/app/components/bank-selector';
```

2. Inside `DashboardPageInner`, after `const spec = parsePeriodFromSearch(searchParams);`:

```ts
  const bank = parseBankFromSearch(searchParams);
```

3. Pass the bank to the hook:

```ts
  const { data: view, loading: dashLoading, error } = useDashboard(
    hasPeriod ? spec : null,
    bank,
  );
```

4. In the `header` JSX, replace the lone `<PeriodSelector current={spec} />` with:

```tsx
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <BankSelector
            current={bank}
            available={view?.availableBanks ?? (bank ? [bank] : [])}
          />
          <PeriodSelector current={spec} />
        </div>
```

The `?? (bank ? [bank] : [])` fallback keeps the current selection visible while the view is loading, when `view` is null.

- [ ] **Step 7: Verify in the running app**

```bash
pnpm dev:local
```

Open the dashboard, upload both a TPBank and a VIB statement for the same month, and confirm: the dropdown lists All banks / TPB / VIB; selecting one updates `?bank=` in the URL, keeps the period params, and changes the KPI totals; a refresh preserves the selection; the browser back button restores the previous bank.

- [ ] **Step 8: Run the suite, types, and lint**

```bash
pnpm test && pnpm tsc --noEmit && pnpm lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add components/ui/select.tsx app/components/bank-selector.tsx \
  app/__tests__/bank-selector.test.tsx app/page.tsx
git commit -m "feat: add a bank filter dropdown to the dashboard"
```

---

### Task 12: Upload error messages and documentation

**Files:**
- Modify: `packages/domain/src/upload-error.ts`
- Modify: `frontend/hooks/use-upload-job.ts:184-188`
- Modify: `lib/__tests__/upload-error.test.ts`
- Modify: `CLAUDE.md`, `AGENTS.md`, `README.md`, `.env.example`, `docs/local-development.md`

**Interfaces:**
- Consumes: the `'UNSUPPORTED_BANK'` error code (Task 7).
- Produces: `uploadErrorMessage(code: string | undefined): string`.

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/upload-error.test.ts`:

```ts
describe('uploadErrorMessage', () => {
  it('explains an unrecognised bank', () => {
    expect(uploadErrorMessage('UNSUPPORTED_BANK')).toMatch(/TPBank and VIB/);
  });

  it('explains a failed decryption', () => {
    expect(uploadErrorMessage('WRONG_PASSWORD')).toMatch(/password/i);
  });

  it('falls back for an unknown code', () => {
    expect(uploadErrorMessage('SOMETHING_NEW')).toBe('Processing failed');
  });

  it('falls back when no code is given', () => {
    expect(uploadErrorMessage(undefined)).toBe('Processing failed');
  });
});
```

Add `uploadErrorMessage` to that file's existing import from `@cashight/domain/upload-error`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/__tests__/upload-error.test.ts`
Expected: FAIL — `uploadErrorMessage is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/domain/src/upload-error.ts`:

```ts
/**
 * User-facing text for the terminal error codes the parser worker can set.
 * Codes not listed here fall back to a generic message rather than being shown
 * raw — an error code is not a sentence.
 */
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  UNSUPPORTED_BANK:
    "We couldn't recognise this statement's bank. Cashight supports TPBank and VIB.",
  WRONG_PASSWORD:
    'This PDF is password-protected and none of the configured passwords unlocked it.',
  INVALID_PDF: "That file doesn't look like a PDF.",
  CHECKSUM_MISMATCH:
    'The uploaded file did not match its checksum. Please try uploading it again.',
  PARSE_ERROR:
    "We couldn't read this statement. Please check it is an unmodified bank statement PDF.",
};

export function uploadErrorMessage(code: string | undefined): string {
  if (!code) return 'Processing failed';
  return UPLOAD_ERROR_MESSAGES[code] ?? 'Processing failed';
}
```

- [ ] **Step 4: Use it in the upload hook**

In `frontend/hooks/use-upload-job.ts`, add the import:

```ts
import { uploadErrorMessage } from '@cashight/domain/upload-error';
```

and replace the `FAILED` branch's error line:

```ts
              error: uploadErrorMessage(finalJob.errorCode),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test lib/__tests__/upload-error.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the documentation**

**`CLAUDE.md`:**
- In "What you're building", change item 1 to name both banks and both parser strategies: TPBank via regex over `pdf-parse` text, VIB via coordinate-based layout extraction, with bank auto-detection from marker strings.
- Under "Architectural conventions", add:
  - *Bank knowledge lives in `packages/domain/src/banks.ts`* — codes, short names, detection markers, and `?bank=` parsing. Adding a bank means adding a profile there plus a parser.
  - *Vietnamese number format is per-bank.* TPBank uses `.` as the thousands separator (`17.184.741`); VIB uses `,` with a `.` decimal (`5,591,567.00`). Each conversion lives only in that bank's parser module.
  - *VIB descriptions embed PII* — masked PAN, card-account number, cardholder name — and are scrubbed by `scrubVibDescription` at the parser boundary before reaching storage or the Gemini payload.
  - *The VIB parser reconciles against the statement's own total-debit figure* and throws when they disagree.
- Under "Data flow", note that the upload path now runs `extractPdfText` → `detectBank` → the bank's parser.
- Under "Environment variables", document that the PDF password secret holds a JSON map of candidate passwords (keys are labels; values are tried in order) and that a plain string is still accepted.
- Add the VIB acceptance numbers beside the TPBank ones, with the fixture path `test-pdfs/vib_saoke_07_2026_4550.pdf`:
  `bank 'VIB'`, `cardLast4 '4550'`, `statementDate '2026-07-25'`, `paymentDueDate '2026-08-10'`, `creditLimit 124000000`, `statementBalance 5591567`, `minimumPayment 5582360`, `totalSpend 0`, `totalInstallments 5581667`, `totalFeesAndInterest 9900`, `transactions.length 3`.

**`AGENTS.md`:** mirror the same points in the "Architecture & Runtime Constraints", "Testing Guidelines", and "Security & Configuration" sections. Add that the polyfill import must precede any `pdfjs-dist` import, and that `dist/lambdas/parser-worker/pdf.worker.mjs` is required at runtime.

**`README.md`:** update the feature bullet to say TPBank and VIB with auto-detection, and mention the dashboard bank filter.

**`.env.example`:** add beneath the existing `PDF_PASSWORD` entry:

```
# Candidate PDF passwords for the local stack, one per bank. Keys are labels
# only — every value is tried in turn, because the bank cannot be known before
# the PDF is decrypted. Falls back to PDF_PASSWORD when unset.
PDF_PASSWORDS=
```

**`docs/local-development.md`:** in the Secrets Manager row of the services table, note that the local stack reads `PDF_PASSWORDS` (JSON map) and falls back to `PDF_PASSWORD`.

- [ ] **Step 7: Verify the whole tree**

```bash
pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build:lambdas
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/upload-error.ts frontend/hooks/use-upload-job.ts \
  lib/__tests__/upload-error.test.ts CLAUDE.md AGENTS.md README.md \
  .env.example docs/local-development.md
git commit -m "feat: map upload error codes to readable messages and document VIB support"
```

---

## Deployment notes

Not code changes, but the feature is not live until these are done:

1. **Rotate the PDF password secret to the JSON map shape.** The secret is `/cashight/prod/pdf-password` in Secrets Manager (`ap-southeast-1`); Terraform manages only its metadata, not its value, so no `terraform apply` is needed.

```bash
aws secretsmanager put-secret-value \
  --region ap-southeast-1 \
  --secret-id /cashight/prod/pdf-password \
  --secret-string '{"TPB":"<existing password>","VIB":"26034550"}'
```

Read the current value first (`aws secretsmanager get-secret-value --secret-id /cashight/prod/pdf-password --region ap-southeast-1 --query SecretString --output text`) so the TPBank password is carried over. Do not paste either password into a commit, a log, or a PR description.

2. **Deploy the Lambdas and the frontend** through the existing release path. `parser-worker` must ship with `pdf.worker.mjs` beside `index.js` — `scripts/build-lambdas.mjs` already handles this, but confirm it is present in the uploaded artifact.

3. **Smoke test in production:** upload the VIB statement, confirm the job reaches `SUCCEEDED`, the statement appears in the list with a `VIB` badge, and the dashboard dropdown offers both banks. Then re-upload a TPBank statement to confirm no regression.

## Self-review notes

- Two defects found and fixed during review: (a) the amount regex accepted a bare digit run, which would have let the auto-debit account number pass as an amount — it now requires either comma grouping or an explicit decimal; (b) `categorize()` had no rules for VIB's wording, so a VIB fee would have landed in `Other`, which `NON_SPEND` does not exclude — the parser's `totals.totalSpend` and `dashboard-aggregations.totalSpend()` would then have disagreed for the same statement. Task 3 now widens the three structural rules.
- Spec coverage: bank registry (T1), layout extraction (T2), VIB fields + scrubbing + categorization (T3), VIB parser + integrity check + fixture + acceptance numbers + privacy invariant (T4), TPBank split (T5), dispatcher + `UnsupportedBankError` (T6), password map + `UNSUPPORTED_BANK` + metadata `bank` + local stack (T7), statements list Bank column (T8), `aggregate()` filter + `availableBanks` (T9), dashboard API + hook (T10), dropdown UI (T11), error messages + docs (T12). Storage keys are untouched, as specified.
- The `bank` field is `'TPBank' | 'VIB'` everywhere; short names appear only in `bankShortName` and the two UI call sites.
- `parsePdf` is `(buffer, passwords: string[])` in every place it appears (T7 dep type, T7 handler, T7 local stack).
