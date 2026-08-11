const MAX_INVOICE_CENTS = 9_007_199_254_740_991;

export type AwsInvoiceParseErrorCode =
  | 'INVALID_USD_AMOUNT'
  | 'INVALID_USD_CENTS'
  | 'INVALID_INVOICE_DATE'
  | 'INVALID_BILLING_PERIOD'
  | 'INVALID_ACCOUNT_ID'
  | 'UNSAFE_SERVICE_NAME';

export class AwsInvoiceParseError extends Error {
  readonly code: AwsInvoiceParseErrorCode;

  constructor(code: AwsInvoiceParseErrorCode) {
    super(`AWS invoice field rejected: ${code}`);
    this.name = 'AwsInvoiceParseError';
    this.code = code;
  }
}

export type ReconciliationLabel =
  | 'SERVICE_TOTAL'
  | 'LINKED_ACCOUNT_TOTAL'
  | 'LINKED_ACCOUNT_CHARGES'
  | 'LINKED_ACCOUNT_TAX'
  | 'CONSOLIDATED_CHARGES'
  | 'CONSOLIDATED_TAX'
  | 'LINKED_ACCOUNT_SUM'
  | 'INVOICE_AMOUNT';

export class InvoiceTotalMismatchError extends Error {
  readonly code = 'INVOICE_TOTAL_MISMATCH' as const;
  readonly label: ReconciliationLabel;

  constructor(label: ReconciliationLabel) {
    super(`AWS invoice reconciliation failed: ${label}`);
    this.name = 'InvoiceTotalMismatchError';
    this.label = label;
  }
}

const MONTHS = new Map<string, number>([
  ['january', 1],
  ['jan', 1],
  ['february', 2],
  ['feb', 2],
  ['march', 3],
  ['mar', 3],
  ['april', 4],
  ['apr', 4],
  ['may', 5],
  ['june', 6],
  ['jun', 6],
  ['july', 7],
  ['jul', 7],
  ['august', 8],
  ['aug', 8],
  ['september', 9],
  ['sep', 9],
  ['october', 10],
  ['oct', 10],
  ['november', 11],
  ['nov', 11],
  ['december', 12],
  ['dec', 12],
]);

function isoDate(year: number, month: number, day: number): string | undefined {
  const value = `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    return undefined;
  }
  return value;
}

function monthNumber(value: string): number | undefined {
  return MONTHS.get(value.toLowerCase());
}

export function parseAwsInvoiceDate(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const monthFirst = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(normalized);
  const dayFirst = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(normalized);

  const month = monthFirst
    ? monthNumber(monthFirst[1])
    : dayFirst
      ? monthNumber(dayFirst[2])
      : undefined;
  const day = Number(monthFirst?.[2] ?? dayFirst?.[1]);
  const year = Number(monthFirst?.[3] ?? dayFirst?.[3]);
  const parsed = month === undefined ? undefined : isoDate(year, month, day);

  if (!parsed) throw new AwsInvoiceParseError('INVALID_INVOICE_DATE');
  return parsed;
}

export function parseAwsBillingPeriod(value: string): {
  start: string;
  end: string;
} {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const full = /^([A-Za-z]+ \d{1,2}, \d{4})\s+[–-]\s+([A-Za-z]+ \d{1,2}, \d{4})$/.exec(
    normalized,
  );
  const short = /^([A-Za-z]+) (\d{1,2})\s+[–-]\s+([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(
    normalized,
  );

  try {
    let start: string;
    let end: string;
    if (full) {
      start = parseAwsInvoiceDate(full[1]);
      end = parseAwsInvoiceDate(full[2]);
    } else if (short) {
      const startMonth = monthNumber(short[1]);
      const endMonth = monthNumber(short[3]);
      if (startMonth === undefined || startMonth !== endMonth) {
        throw new AwsInvoiceParseError('INVALID_BILLING_PERIOD');
      }
      const year = Number(short[5]);
      start = isoDate(year, startMonth, Number(short[2])) ?? '';
      end = isoDate(year, endMonth, Number(short[4])) ?? '';
    } else {
      throw new AwsInvoiceParseError('INVALID_BILLING_PERIOD');
    }

    if (!start || !end || start > end) {
      throw new AwsInvoiceParseError('INVALID_BILLING_PERIOD');
    }
    return { start, end };
  } catch {
    throw new AwsInvoiceParseError('INVALID_BILLING_PERIOD');
  }
}

export function parseUsdCents(value: string): number {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const match = /^USD ([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\.([0-9]{2})$/.exec(
    normalized,
  );
  if (!match) throw new AwsInvoiceParseError('INVALID_USD_AMOUNT');

  const dollars = Number(match[1].replaceAll(',', ''));
  const cents = dollars * 100 + Number(match[2]);
  if (!Number.isSafeInteger(cents) || cents > MAX_INVOICE_CENTS) {
    throw new AwsInvoiceParseError('INVALID_USD_AMOUNT');
  }
  return cents;
}

export function centsToUsdNumber(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_INVOICE_CENTS) {
    throw new AwsInvoiceParseError('INVALID_USD_CENTS');
  }
  return cents / 100;
}

export function maskAwsAccountId(value: string): string {
  if (!/^\d{12}$/.test(value)) {
    throw new AwsInvoiceParseError('INVALID_ACCOUNT_ID');
  }
  return value.slice(-4);
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const ACCOUNT_ID_PATTERN = /\b\d{12}\b/;
const PRIVATE_LABEL_PATTERN =
  /\b(?:bill(?:ing)?\s+to|billing\s+address|address|invoice\s+(?:number|no\.?|id)|street|st\.|road|rd\.|avenue|ave\.|boulevard|lane)\b/i;

export function safeServiceName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    EMAIL_PATTERN.test(normalized) ||
    ACCOUNT_ID_PATTERN.test(normalized) ||
    PRIVATE_LABEL_PATTERN.test(normalized)
  ) {
    throw new AwsInvoiceParseError('UNSAFE_SERVICE_NAME');
  }
  return normalized;
}

export function reconcileCents(
  label: ReconciliationLabel,
  expected: number,
  actual: number,
): void {
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(actual)) {
    throw new AwsInvoiceParseError('INVALID_USD_CENTS');
  }
  if (expected !== actual) throw new InvoiceTotalMismatchError(label);
}
