# Step 02 — TPBank PDF Parser & Categorization

> Build the deterministic parser that turns a TPBank PDF into a validated `Statement` object, plus the merchant→category rule engine.

**Estimated effort:** 3–4 hours (this is the most complex step)
**Prerequisites:** Step 01
**Phase:** 1 — MVP

---

## Goal

A CLI-testable parser that reads `test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf` and outputs a fully populated, Zod-validated `Statement` object — including correctly categorized transactions.

## Tasks

### Parser (`lib/parsers/tpbank.ts`)

1. **Extract raw text** with `pdf-parse`:
   ```ts
   import pdf from 'pdf-parse';
   const data = await pdf(buffer);
   const text = data.text;
   ```

2. **Extract statement metadata** via regex from the header block:
   - Card number → mask to `cardLast4` (last 4 digits only — never store the full PAN)
   - Statement date (`Ngày lập bảng`)
   - Payment due date (`Thanh toán trước ngày`)
   - Credit limit (`Hạn mức`)
   - Previous balance, statement balance, minimum payment

3. **Split the transaction body into sections** using these Vietnamese markers:
   - Everything before `Giao dịch trả góp trong kỳ` → regular transactions + payments
   - Between that marker and `Giá trị hoàn tiền kỳ này` → installments
   - Between that and `Giá trị giao dịch thẻ kỳ này` → cashback
   - After the spend-this-month marker → fees, interest, foreign txn fees

4. **Parse transaction rows** with regex. The base pattern:
   ```
   ^(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(VND|USD)\s+([\d.,]+)\s+([\d.,]+)$
   ```
   Handle these edge cases:
   - Multi-line descriptions (Uniqlo, AEON Celadon) — the description wraps to the next line
   - USD transactions have both an original USD amount and a debit VND amount
   - Credit rows (payments, cashback) appear in the `Ghi có` column instead of `Ghi nợ`

5. **Normalize each transaction** to the `TransactionSchema` shape:
   - Parse `DD/MM/YYYY` dates to ISO `YYYY-MM-DD`
   - Parse Vietnamese number format (`17.184.741` → `17184741`)
   - Set `isInstallment: true` for rows in the installment section
   - Set `isInternational: true` when there's a corresponding `Phi xu ly GD quoc te` fee

6. **Compute totals** to populate `Statement.totals`:
   - Sum from each section
   - `totalSpend` should match the statement's `Giá trị giao dịch thẻ kỳ này` line (sanity check)

7. **Validate with Zod** before returning:
   ```ts
   return StatementSchema.parse(rawStatement);
   ```

### Categorization (`lib/categorize.ts`)

1. **Implement the rule-based categorizer** from master plan §9:
   ```ts
   const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
     { pattern: /shopee|lazada|tiki|sendo/i, category: 'E-commerce' },
     { pattern: /foody|texas chicken|kfc|lotteria/i, category: 'Food & Dining' },
     // ... full table from §9
   ];

   export function categorize(description: string): string {
     for (const { pattern, category } of CATEGORY_RULES) {
       if (pattern.test(description)) return category;
     }
     return 'Other';
   }
   ```

2. **Special-case rules:**
   - Rows containing `Phi xu ly` or `Lai` (interest) → `Fees & Interest`
   - Rows containing `Instalment cancellation` → `Fees & Interest`
   - Rows in the installment section → `Installments` (regardless of merchant)
   - Rows in the cashback section → `Cashback`

3. **Normalize merchant names** alongside categorization:
   - Strip location suffixes (`,HO CHI MINHVIET NAM`, `,IRELAND`, `,UNITED STATES`)
   - Strip trailing whitespace and statement codes
   - Map known variants to canonical names (`Amazon web services` → `AWS`)

### CLI test script (`scripts/test-parser.ts`)

Create a script to validate the parser end-to-end:
```ts
import fs from 'fs/promises';
import { parseTPBankStatement } from '../lib/parsers/tpbank';

const buffer = await fs.readFile('test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf');
const statement = await parseTPBankStatement(buffer);
console.log(JSON.stringify(statement, null, 2));
```

Run with:
```bash
pnpm tsx scripts/test-parser.ts
```

## Files affected

- `lib/parsers/tpbank.ts` — **create**
- `lib/categorize.ts` — **create**
- `scripts/test-parser.ts` — **create**
- `package.json` — add `tsx` as dev dep

## Acceptance criteria

Running `pnpm tsx scripts/test-parser.ts` on the sample PDF:

- Outputs a valid JSON `Statement` object
- `statement.totals.statementBalance === 37978402`
- `statement.totals.totalSpend === 26986712`
- `statement.totals.totalCashback === 519020`
- `statement.transactions.length` is approximately 27 (count the rows in the PDF)
- Every transaction has a `category` that is not `Other` for known merchants (Shopee, AWS, Apple, etc.)
- `statement.cardLast4 === '9674'` and the full PAN appears nowhere in the output

## Notes & gotchas

- **`pdf-parse` output is text without reliable column structure.** The transaction table rows often wrap or have variable whitespace. Build the parser iteratively: start by logging the raw text, then write regex patterns one section at a time.
- **Vietnamese number format uses `.` as thousands separator** — `17.184.741` means seventeen million, not seventeen. Strip dots before `parseInt`.
- **The two anomalous rows** in the sample (HKD LE PHUONG and Shopee 31/12/2025 with mismatched original vs debit amounts) are normal — store both values, trust the debit column for charting.
- **Don't try to perfect this in one pass.** Get 90% of transactions parsing correctly, then iterate. The remaining 10% (multi-line descriptions especially) is where the gnarly regex lives.
- **Mask the card number IMMEDIATELY** after extraction. Do not let the full PAN flow through any function or get logged.

## Next step

[Step 03 — Parse API route + upload UI](./03-parse-api-and-upload-ui.md)
