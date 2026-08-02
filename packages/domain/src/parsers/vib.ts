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
import { StatementSchema, type Statement, type Transaction } from '../schemas';
import { extractPdfLayout, type LayoutPage, type LayoutRow } from './pdf-layout';
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
        row.cells.every((c) => c.x >= COL_DETAILS_MIN && c.x < COL_MCC_MIN);
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
