import { describe, expect, it } from 'vitest';
import {
  AwsInvoiceParseError,
  InvoiceTotalMismatchError,
  centsToUsdNumber,
  maskAwsAccountId,
  parseAwsBillingPeriod,
  parseAwsInvoiceDate,
  parseUsdCents,
  reconcileCents,
  safeServiceName,
} from '@cashight/domain/parsers/aws-invoice/fields';

describe('AWS invoice field parsing', () => {
  it.each([
    ['USD 1,234.56', 123_456],
    ['USD 0.00', 0],
    [' USD\t 1,234.56 ', 123_456],
    ['USD\n1,234.56', 123_456],
    ['USD 1234.56', 123_456],
  ])('parses %s into integer cents', (value, expected) => {
    expect(parseUsdCents(value)).toBe(expected);
  });

  it.each([
    'EUR 1,234.56',
    'USD 1,23.45',
    'USD 1,234.567',
    'USD -1.00',
    'USD (1.00)',
    'USD 1.0',
    'USD 90071992547409.92',
  ])('rejects unsupported amount %s', (value) => {
    expect(() => parseUsdCents(value)).toThrow(AwsInvoiceParseError);
  });

  it('converts safe integer cents to a two-decimal-safe number', () => {
    expect(centsToUsdNumber(123_456)).toBe(1234.56);
    expect(centsToUsdNumber(0)).toBe(0);
    expect(() => centsToUsdNumber(1.5)).toThrow(AwsInvoiceParseError);
  });

  it.each([
    ['August 1, 2026', '2026-08-01'],
    ['Aug 01, 2026', '2026-08-01'],
    ['1 August 2026', '2026-08-01'],
  ])('parses invoice date %s', (value, expected) => {
    expect(parseAwsInvoiceDate(value)).toBe(expected);
  });

  it.each(['February 30, 2026', '2026-08-01', 'Aug 1 26', '']) (
    'rejects malformed invoice date %s',
    (value) => {
      expect(() => parseAwsInvoiceDate(value)).toThrow(AwsInvoiceParseError);
    },
  );

  it.each([
    [
      'July 1, 2026 - July 31, 2026',
      { start: '2026-07-01', end: '2026-07-31' },
    ],
    [
      'Jul 1 - Jul 31, 2026',
      { start: '2026-07-01', end: '2026-07-31' },
    ],
  ])('parses billing period %s', (value, expected) => {
    expect(parseAwsBillingPeriod(value)).toEqual(expected);
  });

  it('rejects reversed and cross-year shorthand billing periods', () => {
    expect(() => parseAwsBillingPeriod('July 31 - July 1, 2026')).toThrow(
      AwsInvoiceParseError,
    );
    expect(() => parseAwsBillingPeriod('December 1 - January 1, 2026')).toThrow(
      AwsInvoiceParseError,
    );
  });
});

describe('AWS invoice privacy transformations', () => {
  it('masks a strict 12-digit AWS account ID at the parser boundary', () => {
    expect(maskAwsAccountId('123456789012')).toBe('9012');
  });

  it.each(['1234', '1234-5678-9012', '12345678901a', ' 123456789012 '])(
    'rejects malformed account ID %s',
    (value) => {
      expect(() => maskAwsAccountId(value)).toThrow(AwsInvoiceParseError);
    },
  );

  it('normalizes a safe service name without changing its meaning', () => {
    expect(safeServiceName('  Amazon   Elastic Compute Cloud  ')).toBe(
      'Amazon Elastic Compute Cloud',
    );
  });

  it.each([
    'Service 123456789012',
    'owner@example.com',
    '123 Private Street',
    'Billing address',
    'Invoice number INV-1',
    'Bill to Private Customer',
    '',
  ])('rejects unsafe service label without echoing it: %s', (value) => {
    let thrown: unknown;
    try {
      safeServiceName(value);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AwsInvoiceParseError);
    if (value) expect(String(thrown)).not.toContain(value);
  });
});

describe('integer-cent reconciliation', () => {
  it('returns when two safe integer-cent totals match', () => {
    expect(reconcileCents('INVOICE_AMOUNT', 10_000, 10_000)).toBeUndefined();
  });

  it('throws a sanitized typed mismatch without source amounts', () => {
    let thrown: unknown;
    try {
      reconcileCents('LINKED_ACCOUNT_TOTAL', 12_345, 12_344);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InvoiceTotalMismatchError);
    expect(thrown).toMatchObject({
      code: 'INVOICE_TOTAL_MISMATCH',
      label: 'LINKED_ACCOUNT_TOTAL',
    });
    expect(String(thrown)).not.toContain('12345');
    expect(String(thrown)).not.toContain('12344');
  });

  it('rejects unsafe or fractional cent inputs', () => {
    expect(() => reconcileCents('SERVICE_TOTAL', 1.5, 1.5)).toThrow(
      AwsInvoiceParseError,
    );
  });
});
