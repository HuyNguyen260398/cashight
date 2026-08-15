import { describe, expect, it } from 'vitest';
import type { LayoutCell, LayoutPage, LayoutRow } from '@cashight/domain/parsers/pdf-layout';
import {
  InvoiceTotalMismatchError,
  UnsupportedAwsInvoiceError,
  knownAwsInvoiceParser,
  parseAwsInvoiceDocument,
} from '@cashight/domain/parsers/aws-invoice';

/**
 * Fixtures mirror the real Amazon Web Services, Inc. consolidated USD invoice
 * layout: an indent-driven outline (section at x=40, item at x=50, component at
 * x=60) with every amount in a right-hand column past x=500.
 *
 * All names, account IDs and amounts here are synthetic. The real sample is
 * never committed; see docs/runbooks/aws-invoice-processing.md.
 *
 * Money layout, chosen so credits are non-zero and therefore actually pin down
 * `total = charges - credits + tax` (a sample with zero credits cannot):
 *
 *   Service A  charges 60.00  tax 10.00 (VAT 3 + GST 2 + CT 1 + US sales tax 4)
 *   Service B  charges 30.00  tax  5.00 (VAT 5)
 *   Service Z  charges  0.00  tax  0.00  -> filtered after reconciliation
 *   invoice    charges 90.00  credits 5.00  tax 15.00  amount due 100.00
 *   account 1  charges 60.00  credits 5.00  tax 10.00  total 65.00
 *   account 2  charges 30.00  credits 0.00  tax  5.00  total 35.00
 */

const SELLER_ROW = 'Amazon Web Services, Inc. Invoice';
const AMOUNT_X = 524;

function row(y: number, ...cells: Array<[number, string]>): LayoutRow {
  return { y, cells: cells.map(([x, text]): LayoutCell => ({ x, text })) };
}

function item(y: number, label: string, amount: string): LayoutRow {
  return row(y, [50, label], [AMOUNT_X, amount]);
}

function component(y: number, label: string, amount: string): LayoutRow {
  return row(y, [60, label], [538, amount]);
}

/** Legal boilerplate that appears on every page of the real invoice. */
function footerRows(startY: number): LayoutRow[] {
  return [
    row(startY, [36, '* May include estimated US sales tax, VAT, ST, GST and CT.']),
    row(startY + 10, [
      36,
      'Amazon Web Services, Inc. is registered under the Singapore GST Overseas Vendor Registration Pay-',
    ], [368, 'Service Provider:']),
    row(startY + 20, [
      36,
      'AWS, Inc. is a "Registered Foreign Supplier" under Japanese Consumption Tax Law and therefore AWS,',
    ], [368, 'Amazon Web Services, Inc.']),
    row(startY + 30, [36, 'All AWS Services are sold by Amazon Web Services, Inc.']),
    row(startY + 40, [36, 'Amazon Web Services, Inc’s US Federal Tax Identification Number is: 00-0000000.']),
    row(startY + 50, [36, 'Page 1 of 2']),
  ];
}

function headerRows(): LayoutRow[] {
  return [
    row(10, [257, SELLER_ROW]),
    row(20, [36, 'Account number:']),
    row(30, [36, '111122223333'], [257, 'Submit feedback on your Invoice Experience here.']),
    row(40, [257, 'Invoice Summary']),
    row(50, [36, 'Bill to Address:'], [257, 'Invoice Number:'], [527, '9876543210']),
    row(60, [36, 'Example Holdings Pte Ltd'], [257, 'Invoice Date:'], [515, 'August 1 , 2026']),
    row(70, [36, 'ATTN: Example Person']),
    row(80, [257, 'TOTAL AMOUNT DUE ON August 1 , 2026'], [522, 'USD 100.00']),
    row(90, [36, '123 Example Street']),
    row(100, [36, 'Example City, Example State, 00000, VN']),
    row(110, [36, 'This invoice is for the billing period July 1 - July 31 , 2026']),
    row(120, [36, "Greetings from Amazon Web Services, we're writing to provide you with an electronic invoice"]),
  ];
}

function summaryRows(): LayoutRow[] {
  return [
    row(130, [40, 'Summary']),
    item(140, 'AWS Service Charges', 'USD 100.00'),
    component(150, 'Charges', 'USD 90.00'),
    component(160, 'Credits', 'USD 5.00'),
    component(170, 'Tax', 'USD 15.00'),
    row(180, [40, 'Total for this invoice'], [AMOUNT_X, 'USD 100.00']),
  ];
}

/** Consolidated detail, deliberately split across a page boundary. */
function consolidatedPageOne(): LayoutRow[] {
  return [
    row(190, [40, 'Detail for Consolidated Bill']),
    item(200, 'Example Service A', 'USD 70.00'),
    component(210, 'Charges', 'USD 60.00'),
    component(220, 'VAT **', 'USD 3.00'),
    component(230, 'GST', 'USD 2.00'),
    component(240, 'Estimated US sales tax to be collected', 'USD 4.00'),
    component(250, 'CT', 'USD 1.00'),
  ];
}

function consolidatedPageTwo(): LayoutRow[] {
  return [
    item(20, 'Example Service B', 'USD 35.00'),
    component(30, 'Charges', 'USD 30.00'),
    component(40, 'VAT **', 'USD 5.00'),
    item(50, 'Example Service Z', 'USD 0.00'),
    component(60, 'Charges', 'USD 0.00'),
    component(70, 'VAT **', 'USD 0.00'),
  ];
}

function allocationRows(): LayoutRow[] {
  return [
    row(100, [36, 'LINKED ACCOUNT ALLOCATION']),
    row(110, [40, 'Activity By Account']),
    item(120, 'Example Person (111122223333)', 'USD 65.00'),
    component(130, 'Charges', 'USD 60.00'),
    component(140, 'Credits', 'USD 5.00'),
    component(150, 'VAT **', 'USD 10.00'),
    item(160, 'Example Person (444455556666)', 'USD 35.00'),
    component(170, 'Charges', 'USD 30.00'),
    component(180, 'Credits', 'USD 0.00'),
    component(190, 'VAT **', 'USD 5.00'),
    row(200, [40, 'Total allocated for this invoice'], [AMOUNT_X, 'USD 100.00']),
  ];
}

function accountOneRows(): LayoutRow[] {
  return [
    row(210, [40, 'Summary for Linked Account']),
    item(220, 'Example Person (111122223333)', 'USD 65.00'),
    component(230, 'Charges', 'USD 60.00'),
    component(240, 'Credits', 'USD 5.00'),
    component(250, 'VAT **', 'USD 10.00'),
    row(260, [40, 'Account 111122223333 total allocated for this invoice'], [AMOUNT_X, 'USD 65.00']),
    row(270, [40, 'Detail for Linked Account']),
    item(280, 'Example Service A', 'USD 70.00'),
    component(290, 'Charges', 'USD 60.00'),
    component(300, 'VAT **', 'USD 10.00'),
  ];
}

function accountTwoRows(): LayoutRow[] {
  return [
    row(310, [40, 'Summary for Linked Account']),
    item(320, 'Example Person (444455556666)', 'USD 35.00'),
    component(330, 'Charges', 'USD 30.00'),
    component(340, 'Credits', 'USD 0.00'),
    component(350, 'VAT **', 'USD 5.00'),
    row(360, [40, 'Account 444455556666 total allocated for this invoice'], [AMOUNT_X, 'USD 35.00']),
    row(370, [40, 'Detail for Linked Account']),
    item(380, 'Example Service B', 'USD 35.00'),
    component(390, 'Charges', 'USD 30.00'),
    component(400, 'VAT **', 'USD 5.00'),
  ];
}

function knownLayoutPages(): LayoutPage[] {
  return [
    {
      pageNumber: 1,
      rows: [...headerRows(), ...summaryRows(), ...consolidatedPageOne(), ...footerRows(600)],
    },
    {
      pageNumber: 2,
      rows: [...consolidatedPageTwo(), ...allocationRows(), ...footerRows(600)],
    },
    {
      pageNumber: 3,
      rows: [...accountOneRows(), ...accountTwoRows(), ...footerRows(600)],
    },
  ];
}

const SOURCE = {
  sha256: 'a'.repeat(64),
  uploadedAt: '2026-08-03T00:00:00.000Z',
};

function parseFixture(pages: LayoutPage[] = knownLayoutPages()) {
  return parseAwsInvoiceDocument({ pages, ...SOURCE });
}

/** Drop every row whose joined text matches, to test missing markers. */
function withoutRow(pages: LayoutPage[], text: string): LayoutPage[] {
  return pages.map((page) => ({
    ...page,
    rows: page.rows.filter(
      (r) => r.cells.map((c) => c.text).join(' ').trim() !== text,
    ),
  }));
}

function replaceCellText(
  pages: LayoutPage[],
  from: string,
  to: string,
): LayoutPage[] {
  return pages.map((page) => ({
    ...page,
    rows: page.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c) => (c.text === from ? { ...c, text: to } : c)),
    })),
  }));
}

describe('known AWS invoice recognition', () => {
  it('recognizes the real consolidated layout', () => {
    expect(knownAwsInvoiceParser.canParse({ pages: knownLayoutPages() })).toBe(true);
  });

  it('is not blocked by repeated AWS legal boilerplate', () => {
    // Regression: every page repeats "Amazon Web Services, Inc. is registered
    // under the Singapore GST..." which must not read as a conflicting seller.
    const pages = knownLayoutPages();
    const boilerplate = pages
      .flatMap((p) => p.rows)
      .filter((r) => r.cells.some((c) => c.text.startsWith('Amazon Web Services')));
    expect(boilerplate.length).toBeGreaterThan(3);
    expect(knownAwsInvoiceParser.canParse({ pages })).toBe(true);
  });

  it.each([
    'Invoice Summary',
    'Detail for Consolidated Bill',
    'Activity By Account',
  ])('fails closed without the %s marker', (marker) => {
    const pages = withoutRow(knownLayoutPages(), marker);
    expect(knownAwsInvoiceParser.canParse({ pages })).toBe(false);
  });

  it('fails closed on a different AWS selling entity', () => {
    const pages = replaceCellText(
      knownLayoutPages(),
      SELLER_ROW,
      'Amazon Web Services EMEA SARL Invoice',
    );
    expect(knownAwsInvoiceParser.canParse({ pages })).toBe(false);
  });

  it('throws a typed unsupported error when nothing recognizes the document', () => {
    expect(() =>
      parseAwsInvoiceDocument({
        pages: [{ pageNumber: 1, rows: [row(10, [36, 'Some other document'])] }],
        ...SOURCE,
      }),
    ).toThrow(UnsupportedAwsInvoiceError);
  });
});

describe('known AWS invoice parsing', () => {
  it('parses header fields from the real layout', () => {
    const invoice = parseFixture();
    expect(invoice.seller).toBe('Amazon Web Services, Inc.');
    expect(invoice.currency).toBe('USD');
    expect(invoice.billingPeriod).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(invoice.invoiceDate).toBe('2026-08-01');
    expect(invoice.dueDate).toBe('2026-08-01');
  });

  it('parses invoice totals with non-zero credits', () => {
    expect(parseFixture().totals).toEqual({
      charges: 90,
      credits: 5,
      tax: 15,
      amountDue: 100,
    });
  });

  it('sums the separately-labelled tax lines into one service tax', () => {
    const serviceA = parseFixture().services.find(
      ({ name }) => name === 'Example Service A',
    );
    // VAT 3 + GST 2 + US sales tax 4 + CT 1
    expect(serviceA).toEqual({
      name: 'Example Service A',
      charges: 60,
      tax: 10,
      total: 70,
    });
  });

  it('continues a service section across a page boundary', () => {
    const names = parseFixture().services.map(({ name }) => name);
    // Service A is on page 1, Service B on page 2 under the same section.
    expect(names).toContain('Example Service A');
    expect(names).toContain('Example Service B');
  });

  it('filters zero-only services after they reconcile', () => {
    const names = parseFixture().services.map(({ name }) => name);
    expect(names).not.toContain('Example Service Z');
    expect(names).toEqual(['Example Service A', 'Example Service B']);
  });

  it('masks linked accounts to last four and drops the account label', () => {
    const invoice = parseFixture();
    expect(invoice.linkedAccounts.map((a) => a.accountLast4)).toEqual(['3333', '6666']);
    expect(JSON.stringify(invoice)).not.toContain('Example Person');
    expect(JSON.stringify(invoice)).not.toContain('111122223333');
  });

  it('parses per-account totals and services', () => {
    const [first, second] = parseFixture().linkedAccounts;
    expect(first).toEqual({
      accountLast4: '3333',
      charges: 60,
      credits: 5,
      tax: 10,
      total: 65,
      services: [{ name: 'Example Service A', charges: 60, tax: 10, total: 70 }],
    });
    expect(second.accountLast4).toBe('6666');
    expect(second.total).toBe(35);
  });

  it('returns no bill-to, invoice number, or raw text', () => {
    const serialized = JSON.stringify(parseFixture());
    for (const prohibited of [
      '9876543210',
      'Example Holdings',
      'Example Street',
      'Bill to',
      'Invoice Number',
      'Greetings from Amazon',
    ]) {
      expect(serialized).not.toContain(prohibited);
    }
  });

  it('records the parser identity', () => {
    expect(parseFixture().source).toEqual({
      parserId: 'aws-inc-consolidated-usd',
      parserVersion: expect.any(Number),
      ...SOURCE,
    });
  });
});

describe('known AWS invoice reconciliation', () => {
  it('throws when a service total disagrees with its components', () => {
    const pages = replaceCellText(knownLayoutPages(), 'USD 70.00', 'USD 71.00');
    expect(() => parseFixture(pages)).toThrow(InvoiceTotalMismatchError);
  });

  it('throws when the invoice amount due disagrees with the summary', () => {
    const pages = knownLayoutPages().map((page) => ({
      ...page,
      rows: page.rows.map((r) =>
        r.cells[0]?.text === 'Total for this invoice'
          ? row(r.y, [40, 'Total for this invoice'], [AMOUNT_X, 'USD 101.00'])
          : r,
      ),
    }));
    expect(() => parseFixture(pages)).toThrow(InvoiceTotalMismatchError);
  });

  it('throws when linked-account totals do not sum to the invoice', () => {
    const pages = knownLayoutPages().map((page) => ({
      ...page,
      rows: page.rows.map((r) =>
        r.cells[0]?.text === 'Total allocated for this invoice'
          ? row(r.y, [40, 'Total allocated for this invoice'], [AMOUNT_X, 'USD 99.00'])
          : r,
      ),
    }));
    expect(() => parseFixture(pages)).toThrow(InvoiceTotalMismatchError);
  });

  it('fails closed on an unrecognized component label', () => {
    const pages = replaceCellText(knownLayoutPages(), 'GST', 'Mystery Levy');
    expect(() => parseFixture(pages)).toThrow();
  });
});
