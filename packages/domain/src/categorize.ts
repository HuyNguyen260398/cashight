/**
 * Merchant categorization and name normalization for parsed TPBank
 * credit-card statement transactions.
 *
 * Both exported functions are PURE: no I/O, no logging, no mutation of
 * shared state. They operate on the RAW transaction description strings
 * produced by the PDF parser. Descriptions never contain card numbers.
 */

/** Installment marker prefix glued to the front of some descriptions. */
const INSTALLMENT_PREFIX = 'Giao dich tra gop';

/**
 * Canonical category strings used across the project. The fallback is
 * 'Other'. Special categories (Fees & Interest, Installments, Cashback,
 * Payment) are decided by the special-case rules below.
 */
type Category =
  | 'E-commerce'
  | 'Food & Dining'
  | 'Groceries'
  | 'Shopping'
  | 'Software & Subscriptions'
  | 'Entertainment'
  | 'Travel'
  | 'Fees & Interest'
  | 'Installments'
  | 'Cashback'
  | 'Payment'
  | 'Other';

interface Rule {
  pattern: RegExp;
  category: Category;
}

/**
 * Special-case rules, checked FIRST and in order. These match structural
 * markers (fees, installments, cashback, repayments) rather than merchants.
 */
const SPECIAL_RULES: Rule[] = [
  // 1. Fees & interest. `Lai` (interest) is anchored to the line start with a
  //    word boundary so it does not match inside other words.
  {
    pattern: /Instalment cancellation|Phi xu ly|^Lai\b/i,
    category: 'Fees & Interest',
  },
  // 2. Installment marker.
  { pattern: /Giao dich tra gop/i, category: 'Installments' },
  // 3. Cashback: contains HOAN TIEN or starts with CREDIT_.
  { pattern: /HOAN TIEN|^CREDIT_/i, category: 'Cashback' },
  // 4. Card repayment.
  { pattern: /TT QUA TPBANK/i, category: 'Payment' },
];

/**
 * Merchant rule table, checked top-to-bottom; first match wins. Patterns are
 * tested against the RAW description so location/domain text is available.
 *
 * Ordering nuances:
 * - `youtube` must come before the bare `google` rule so "Google YouTube"
 *   lands in Entertainment rather than Software.
 */
const MERCHANT_RULES: Rule[] = [
  // E-commerce
  { pattern: /shopee|lazada|tiki|sendo/i, category: 'E-commerce' },

  // Food & Dining
  {
    pattern: /foody|texas chicken|kfc|lotteria|highlands|starbucks/i,
    category: 'Food & Dining',
  },

  // Groceries. `co.op` is anchored (and the common "coopmart" spelling added)
  // so it does not match inside words like "cooperation" or "scoop".
  {
    pattern: /aeon|circle\s?k|coopmart|\bco\.?op\b|bach hoa|vinmart|langfarm/i,
    category: 'Groceries',
  },

  // Shopping
  { pattern: /uniqlo|h&m|zara/i, category: 'Shopping' },

  // Entertainment (youtube before bare google)
  { pattern: /youtube|steam|netflix|spotify/i, category: 'Entertainment' },

  // Software & Subscriptions. `aws` is anchored with word boundaries so it does
  // not match inside words like "LAWSON"; "amazon web services" still matches.
  {
    pattern:
      /apple\.com|itunes|claude\.ai|anthropic|amazon web services|\baws\b|google(?! youtube)|adobe|microsoft/i,
    category: 'Software & Subscriptions',
  },

  // Travel
  {
    pattern:
      /agoda|booking\.com|traveloka|vietnam airlines|vietjet|grab/i,
    category: 'Travel',
  },
];

/**
 * Categorize a RAW transaction description into one of the canonical
 * categories. Special-case rules win over the merchant table; first match
 * wins within each list; fallback is 'Other'.
 */
export function categorize(description: string): string {
  for (const { pattern, category } of SPECIAL_RULES) {
    if (pattern.test(description)) return category;
  }
  for (const { pattern, category } of MERCHANT_RULES) {
    if (pattern.test(description)) return category;
  }
  return 'Other';
}

/**
 * Canonical alias map applied (case-insensitively) to the cleaned merchant
 * name. Only add entries with real evidence in the sample data.
 */
const CANONICAL_VARIANTS: ReadonlyArray<{ match: RegExp; canonical: string }> = [
  { match: /^amazon web services$/i, canonical: 'AWS' },
];

/**
 * Normalize a raw transaction description into a clean display name.
 *
 * Steps:
 *  1. Strip a leading "Giao dich tra gop " installment marker.
 *  2. Drop everything from the first comma onward (location/domain noise).
 *  3. Collapse and trim whitespace.
 *  4. Apply canonical alias mapping (e.g. "Amazon web services" -> "AWS").
 */
export function normalizeMerchant(rawDescription: string): string {
  let name = rawDescription;

  // 1. Strip installment prefix if present.
  if (name.toLowerCase().startsWith(INSTALLMENT_PREFIX.toLowerCase())) {
    name = name.slice(INSTALLMENT_PREFIX.length);
  }

  // 2. Cut at the first comma (location/domain suffix).
  const commaIndex = name.indexOf(',');
  if (commaIndex !== -1) {
    name = name.slice(0, commaIndex);
  }

  // 3. Collapse repeated whitespace and trim.
  name = name.replace(/\s+/g, ' ').trim();

  // 4. Canonical aliases.
  for (const { match, canonical } of CANONICAL_VARIANTS) {
    if (match.test(name)) return canonical;
  }

  return name;
}
