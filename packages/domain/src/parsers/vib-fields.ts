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
