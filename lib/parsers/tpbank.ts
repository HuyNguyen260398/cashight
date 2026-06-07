/**
 * Deterministic parser for TPBank Vietnamese credit-card PDF statements.
 *
 * NO LLM is involved. Pure regex / string logic over the text extracted by
 * `pdf-parse`. Must run on the Node runtime (pdf-parse is Node-only).
 *
 * PCI: the full / BIN PAN (e.g. `498796xxxxxx9674`) is masked to its last 4
 * digits IMMEDIATELY after text extraction and never stored, returned, or
 * logged. Only `cardLast4` survives into the output.
 */

// MUST precede the `pdf-parse` import: pdfjs-dist (its engine) references
// `DOMMatrix` while its module body evaluates. On the Amplify Lambda the native
// `@napi-rs/canvas` that would supply it cannot load, so we install the globals
// ourselves first. See lib/pdf-dom-polyfill.ts for the full story.
import '@/lib/pdf-dom-polyfill';
import { PDFParse } from 'pdf-parse';
import { categorize, normalizeMerchant } from '@/lib/categorize';
import {
  StatementSchema,
  type Statement,
  type Transaction,
} from '@/lib/schemas';

/** Currencies the schema accepts; used to recognise the currency token. */
const CURRENCY_TOKENS = [
  'VND',
  'USD',
  'HKD',
  'EUR',
  'GBP',
  'JPY',
  'SGD',
  'AUD',
  'CAD',
] as const;
type Currency = (typeof CURRENCY_TOKENS)[number];
const CURRENCY_ALT = CURRENCY_TOKENS.join('|');

/**
 * A full transaction row, after re-joining any wrapped physical lines:
 *   txnDate postDate description CURRENCY originalAmount amountVnd
 * Dates are DD/MM/YYYY; the two trailing numbers are VND-formatted (or a
 * decimal for foreign original amounts).
 */
const ROW_RE = new RegExp(
  `^(\\d{2}/\\d{2}/\\d{4})\\s+(\\d{2}/\\d{2}/\\d{4})\\s+(.+?)\\s+(${CURRENCY_ALT})\\s+([\\d.,]+)\\s+([\\d.,]+)\\s*$`,
);

/** A line that begins a transaction row (the double-date prefix). */
const ROW_START_RE = /^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s/;

/** Header field patterns (full PAN deliberately captured only to mask it). */
const HEADER = {
  statementDate: /Statement Date\s+(\d{2}\/\d{2}\/\d{4})/,
  cardNumber: /Card Number\s+(\S+)/,
  previousBalance: /Last Month Balance\s+VND\s+([\d.]+)/,
  statementBalance: /Statement Balance\s+VND\s+([\d.]+)/,
  minimumPayment: /Minimum Payment\s+VND\s+([\d.]+)/,
  paymentDueDate: /Payment Due Date\s+(\d{2}\/\d{2}\/\d{4})/,
  creditLimit: /Credit Limit:\s+VND\s+([\d.]+)/,
} as const;

/** Trailing section-delimiter markers (they label the section ABOVE them). */
const MARKER_INSTALLMENTS_END = 'Giao dịch trả góp trong kỳ';
const MARKER_CASHBACK_END = 'Giá trị hoàn tiền kỳ này';
const MARKER_SPEND_END = 'Giá trị giao dịch thẻ kỳ này';
const MARKER_FEES_END = 'Dư nợ sao kê';

type Section = 'INSTALLMENTS' | 'CASHBACK' | 'SPEND' | 'FEES' | 'DONE';

/** Prefix on foreign-fee rows; the remainder is the merchant name. */
const FOREIGN_FEE_PREFIX = 'Phi xu ly GD quoc te ';

/** Parse a Vietnamese-formatted VND integer: strip dots/commas, parseInt. */
function parseVnd(raw: string): number {
  return parseInt(raw.replace(/[.,]/g, ''), 10);
}

/** Convert DD/MM/YYYY -> YYYY-MM-DD. */
function toIsoDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

/** Match a required header field; throw a clear error if absent. */
function requireMatch(text: string, re: RegExp, label: string): string {
  const m = text.match(re);
  if (!m) throw new Error(`TPBank parser: could not find "${label}" in header`);
  return m[1];
}

interface ParsedRow {
  txnDate: string;
  postDate: string;
  rawDesc: string;
  currency: Currency;
  originalAmountStr: string;
  amountVndStr: string;
  section: Section;
}

/**
 * Walk physical lines, re-joining wrapped rows, and emit one ParsedRow per
 * transaction tagged with the section it belongs to. Marker lines advance the
 * section pointer; page-break / opening-balance noise is naturally skipped
 * because it never starts with a double-date and only appears after a buffered
 * row has already completed.
 */
function extractRows(text: string): ParsedRow[] {
  const lines = text.split('\n');
  const rows: ParsedRow[] = [];
  let section: Section = 'INSTALLMENTS';
  let done = false;
  let buffer = '';

  // The transaction table begins after the opening-balance line
  // "Last Month Balance 17.184.741" (no VND token, distinct from the header
  // field). Markers like "Dư nợ sao kê" also appear in the header block, so we
  // must not start scanning until the table proper. Skip every line up to and
  // including the opening-balance line.
  const tableStart = lines.findIndex((l) =>
    /^Last Month Balance\s+[\d.]+\s*$/.test(l.trim()),
  );
  const scanLines = tableStart === -1 ? lines : lines.slice(tableStart + 1);

  const advanceMarker = (line: string): boolean => {
    if (line.includes(MARKER_INSTALLMENTS_END)) {
      section = 'CASHBACK';
      return true;
    }
    if (line.includes(MARKER_CASHBACK_END)) {
      section = 'SPEND';
      return true;
    }
    if (line.includes(MARKER_SPEND_END)) {
      section = 'FEES';
      return true;
    }
    if (line.includes(MARKER_FEES_END)) {
      section = 'DONE';
      done = true;
      return true;
    }
    return false;
  };

  for (const rawLine of scanLines) {
    const line = rawLine.trim();
    if (done) break;

    // If we are not mid-row, a marker line advances the section.
    if (!buffer && advanceMarker(line)) continue;

    if (!buffer) {
      // Only a line beginning with the double-date can start a row.
      if (!ROW_START_RE.test(line)) continue;
      buffer = line;
    } else {
      // We are mid-row: a marker line here would mean the previous buffer
      // never completed — guard against swallowing it.
      if (advanceMarker(line)) {
        buffer = '';
        continue;
      }
      buffer = `${buffer} ${line}`.replace(/\s+/g, ' ').trim();
    }

    const m = buffer.match(ROW_RE);
    if (m) {
      rows.push({
        txnDate: m[1],
        postDate: m[2],
        rawDesc: m[3].trim(),
        currency: m[4] as Currency,
        originalAmountStr: m[5],
        amountVndStr: m[6],
        section,
      });
      buffer = '';
    }
  }

  return rows;
}

/** Build the set of foreign-fee merchant strings from the FEES rows. */
function buildForeignFeeMerchants(rows: ParsedRow[]): string[] {
  const merchants: string[] = [];
  for (const row of rows) {
    if (row.section === 'FEES' && row.rawDesc.startsWith(FOREIGN_FEE_PREFIX)) {
      merchants.push(row.rawDesc.slice(FOREIGN_FEE_PREFIX.length).trim());
    }
  }
  return merchants;
}

/**
 * Extract raw text from a PDF, optionally supplying a decryption password.
 * Destroys the pdf.js parser in all cases (success or error) to avoid leaking
 * workers — every PDFParse instance created must be destroyed.
 *
 * A fresh Uint8Array is allocated per call on purpose: pdf.js TRANSFERS the
 * typed array to its worker and detaches it, so a single array cannot be reused
 * across two PDFParse instances (the unprotected attempt + the password retry).
 * Reusing one throws "DataCloneError: Cannot transfer object of unsupported type".
 */
async function extractText(buffer: Buffer, password?: string): Promise<string> {
  const data = new Uint8Array(buffer);
  const parser = new PDFParse(password ? { data, password } : { data });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export async function parseTPBankStatement(buffer: Buffer, password?: string): Promise<Statement> {
  let text: string;
  try {
    text = await extractText(buffer);
  } catch (err) {
    if (password && err instanceof Error && err.name === 'PasswordException') {
      text = await extractText(buffer, password);
    } else {
      throw err;
    }
  }

  // --- PCI: mask the PAN immediately, derive cardLast4, then drop the rest. ---
  const rawCardNumber = requireMatch(text, HEADER.cardNumber, 'Card Number');
  const last4Match = rawCardNumber.match(/(\d{4})\D*$/);
  if (!last4Match) {
    throw new Error('TPBank parser: could not derive cardLast4 from card number');
  }
  const cardLast4 = last4Match[1];

  // --- Header fields ---
  const statementDate = toIsoDate(
    requireMatch(text, HEADER.statementDate, 'Statement Date'),
  );
  const paymentDueDate = toIsoDate(
    requireMatch(text, HEADER.paymentDueDate, 'Payment Due Date'),
  );
  const previousBalance = parseVnd(
    requireMatch(text, HEADER.previousBalance, 'Last Month Balance'),
  );
  const statementBalance = parseVnd(
    requireMatch(text, HEADER.statementBalance, 'Statement Balance'),
  );
  const minimumPayment = parseVnd(
    requireMatch(text, HEADER.minimumPayment, 'Minimum Payment'),
  );
  const creditLimit = parseVnd(
    requireMatch(text, HEADER.creditLimit, 'Credit Limit'),
  );

  // --- Transaction rows ---
  const parsedRows = extractRows(text);
  const foreignFeeMerchants = buildForeignFeeMerchants(parsedRows);

  const transactions: Transaction[] = [];
  let totalSpend = 0;
  let totalInstallments = 0;
  let totalCashbackMagnitude = 0;
  let totalFeesAndInterest = 0;

  for (const row of parsedRows) {
    const { rawDesc, currency, section } = row;

    const isInstallment = /Giao dich tra gop/i.test(rawDesc);
    const isPayment = /TT QUA TPBANK/i.test(rawDesc);
    const isCashback = section === 'CASHBACK';
    const isCredit = isPayment || isCashback;

    // amountVnd: always the 2nd number (VND). Strip dots; sign for credits.
    const amountVndMagnitude = parseVnd(row.amountVndStr);
    const amountVnd = isCredit ? -amountVndMagnitude : amountVndMagnitude;

    // originalAmount: 1st number, in the row's currency. Non-negative.
    const originalAmount =
      currency === 'VND'
        ? parseVnd(row.originalAmountStr)
        : parseFloat(row.originalAmountStr);

    // isInternational: true for foreign-currency rows, or spend rows whose
    // description matches a foreign-fee merchant. Non-spend rows stay false
    // unless their currency is non-VND.
    let isInternational = currency !== 'VND';
    if (!isInternational && section === 'SPEND') {
      const lowerDesc = rawDesc.toLowerCase();
      isInternational = foreignFeeMerchants.some((m) =>
        lowerDesc.includes(m.toLowerCase()),
      );
    }

    // Tally totals per section.
    if (isInstallment) {
      totalInstallments += amountVndMagnitude;
    } else if (isCashback) {
      totalCashbackMagnitude += amountVndMagnitude;
    } else if (section === 'SPEND') {
      totalSpend += amountVndMagnitude;
    } else if (section === 'FEES') {
      totalFeesAndInterest += amountVndMagnitude;
    }

    transactions.push({
      date: toIsoDate(row.txnDate),
      postingDate: toIsoDate(row.postDate),
      description: normalizeMerchant(rawDesc),
      currency,
      originalAmount,
      amountVnd,
      category: categorize(rawDesc),
      isInstallment,
      isInternational,
    });
  }

  const rawStatement: Statement = {
    bank: 'TPBank',
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
      totalCashback: totalCashbackMagnitude,
      totalFeesAndInterest,
    },
    transactions,
  };

  return StatementSchema.parse(rawStatement);
}
