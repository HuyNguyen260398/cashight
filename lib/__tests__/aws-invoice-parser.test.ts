import { describe, expect, it } from 'vitest';
import type { LayoutCell, LayoutPage, LayoutRow } from '@cashight/domain/parsers/pdf-layout';
import {
  InvoiceTotalMismatchError,
  UnsupportedAwsInvoiceError,
  knownAwsInvoiceParser,
  parseAwsInvoiceDocument,
} from '@cashight/domain/parsers/aws-invoice';

function row(y: number, ...cells: Array<[number, string]>): LayoutRow {
  return {
    y,
    cells: cells.map(([x, text]): LayoutCell => ({ x, text })),
  };
}

function knownLayoutPages(): LayoutPage[] {
  return [
    {
      pageNumber: 1,
      rows: [
        row(780, [40, 'Amazon Web Services, Inc.']),
        row(750, [40, 'Invoice Summary']),
        row(720, [40, 'Billing period'], [300, 'July 1, 2026 - July 31, 2026']),
        row(700, [40, 'Invoice date'], [300, 'August 1, 2026']),
        row(680, [40, 'Due date'], [300, 'August 1, 2026']),
        row(650, [40, 'Total charges'], [400, 'USD'], [450, '100.00']),
        row(630, [40, 'Total credits'], [400, 'USD 0.00']),
        row(610, [40, 'Total tax'], [400, 'USD 10.00']),
        row(590, [40, 'Amount due'], [400, 'USD 110.00']),
        row(20, [40, 'Page 1 of 5']),
      ],
    },
    {
      pageNumber: 2,
      rows: [
        row(780, [40, 'Detail for consolidated bill']),
        row(750, [40, 'Service'], [320, 'Charges'], [410, 'Tax'], [510, 'Total']),
        row(720, [40, 'Example Compute'], [320, 'USD 60.00'], [410, 'USD 6.00'], [510, 'USD 66.00']),
        row(700, [40, 'Example Storage'], [320, 'USD 30.00'], [410, 'USD 3.00'], [510, 'USD 33.00']),
        row(20, [40, 'Page 2 of 5']),
      ],
    },
    {
      pageNumber: 3,
      rows: [
        row(760, [40, 'Example Database'], [320, 'USD 10.00'], [410, 'USD 1.00'], [510, 'USD 11.00']),
        row(740, [40, 'Unused Example'], [320, 'USD 0.00'], [410, 'USD 0.00'], [510, 'USD 0.00']),
        row(700, [40, 'Linked account allocation']),
        row(680, [40, 'Linked account'], [280, 'Charges'], [360, 'Credits'], [430, 'Tax'], [510, 'Total']),
        row(650, [40, '123456789012'], [280, 'USD 60.00'], [360, 'USD 0.00'], [430, 'USD 6.00'], [510, 'USD 66.00']),
        row(630, [40, '999900001234'], [280, 'USD 40.00'], [360, 'USD 0.00'], [430, 'USD 4.00'], [510, 'USD 44.00']),
        row(20, [40, 'Page 3 of 5']),
      ],
    },
    {
      pageNumber: 4,
      rows: [
        row(780, [40, 'Detail for linked account 123456789012']),
        row(750, [40, 'Service'], [320, 'Charges'], [410, 'Tax'], [510, 'Total']),
        row(720, [40, 'Example Compute'], [320, 'USD 60.00'], [410, 'USD 6.00'], [510, 'USD 66.00']),
        row(20, [40, 'Page 4 of 5']),
      ],
    },
    {
      pageNumber: 5,
      rows: [
        row(780, [40, 'Detail for linked account 999900001234']),
        row(750, [40, 'Service'], [320, 'Charges'], [410, 'Tax'], [510, 'Total']),
        row(720, [40, 'Example Storage'], [320, 'USD 30.00'], [410, 'USD 3.00'], [510, 'USD 33.00']),
        row(700, [40, 'Example Database'], [320, 'USD 10.00'], [410, 'USD 1.00'], [510, 'USD 11.00']),
        row(20, [40, 'Page 5 of 5']),
      ],
    },
  ];
}

function replaceRowText(
  pages: LayoutPage[],
  current: string,
  replacement: string,
): LayoutPage[] {
  return pages.map((page) => ({
    ...page,
    rows: page.rows.map((layoutRow) => ({
      ...layoutRow,
      cells: layoutRow.cells.map((cell) => ({
        ...cell,
        text: cell.text === current ? replacement : cell.text,
      })),
    })),
  }));
}

function replaceCell(
  pages: LayoutPage[],
  pageNumber: number,
  rowLabel: string,
  x: number,
  replacement: string,
): LayoutPage[] {
  return pages.map((page) => ({
    ...page,
    rows: page.rows.map((layoutRow) => ({
      ...layoutRow,
      cells: layoutRow.cells.map((cell, index) => ({
        ...cell,
        text:
          page.pageNumber === pageNumber &&
          layoutRow.cells[0]?.text === rowLabel &&
          (cell.x === x || index === x)
            ? replacement
            : cell.text,
      })),
    })),
  }));
}

const source = {
  sha256: 'b'.repeat(64),
  uploadedAt: '2026-08-03T00:00:00.000Z',
};

describe('known AWS invoice recognition', () => {
  it('requires the exact seller and all stable layout markers', () => {
    expect(knownAwsInvoiceParser.canParse({ pages: knownLayoutPages() })).toBe(true);

    for (const marker of [
      'Invoice Summary',
      'Billing period',
      'Detail for consolidated bill',
      'Linked account allocation',
    ]) {
      const pages = replaceRowText(knownLayoutPages(), marker, `Missing ${marker}`);
      expect(knownAwsInvoiceParser.canParse({ pages })).toBe(false);
    }
  });

  it('fails closed when a conflicting AWS seller is present', () => {
    const pages = knownLayoutPages();
    pages[0].rows.push(row(770, [40, 'Amazon Web Services EMEA SARL']));

    expect(knownAwsInvoiceParser.canParse({ pages })).toBe(false);
  });

  it('throws a typed unsupported error when no parser recognizes the document', () => {
    const pages = replaceRowText(
      knownLayoutPages(),
      'Amazon Web Services, Inc.',
      'Different Seller',
    );

    expect(() => parseAwsInvoiceDocument({ pages, ...source })).toThrow(
      UnsupportedAwsInvoiceError,
    );
  });
});

describe('known AWS invoice parsing', () => {
  it('parses continued consolidated and linked-account sections', () => {
    const invoice = parseAwsInvoiceDocument({ pages: knownLayoutPages(), ...source });

    expect(invoice).toEqual({
      seller: 'Amazon Web Services, Inc.',
      billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
      invoiceDate: '2026-08-01',
      dueDate: '2026-08-01',
      currency: 'USD',
      totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
      services: [
        { name: 'Example Compute', charges: 60, tax: 6, total: 66 },
        { name: 'Example Storage', charges: 30, tax: 3, total: 33 },
        { name: 'Example Database', charges: 10, tax: 1, total: 11 },
      ],
      linkedAccounts: [
        {
          accountLast4: '9012',
          charges: 60,
          credits: 0,
          tax: 6,
          total: 66,
          services: [
            { name: 'Example Compute', charges: 60, tax: 6, total: 66 },
          ],
        },
        {
          accountLast4: '1234',
          charges: 40,
          credits: 0,
          tax: 4,
          total: 44,
          services: [
            { name: 'Example Storage', charges: 30, tax: 3, total: 33 },
            { name: 'Example Database', charges: 10, tax: 1, total: 11 },
          ],
        },
      ],
      source: {
        parserId: 'aws-inc-consolidated-usd',
        parserVersion: 1,
        ...source,
      },
    });
  });

  it('lets zero-only services participate in reconciliation before filtering them', () => {
    const invoice = parseAwsInvoiceDocument({ pages: knownLayoutPages(), ...source });

    expect(invoice.services.map(({ name }) => name)).not.toContain('Unused Example');
  });

  it.each([
    [2, 'Example Compute', 510, 'USD 65.99', 'SERVICE_TOTAL'],
    [3, '123456789012', 510, 'USD 65.00', 'LINKED_ACCOUNT_TOTAL'],
    [1, 'Amount due', 400, 'USD 109.00', 'INVOICE_AMOUNT'],
  ])(
    'rejects a reconciled total mutation on page %s as %s',
    (pageNumber, rowLabel, x, replacement, label) => {
      const pages = replaceCell(
        knownLayoutPages(),
        pageNumber as number,
        rowLabel as string,
        x as number,
        replacement as string,
      );

      try {
        parseAwsInvoiceDocument({ pages, ...source });
        throw new Error('Expected parser to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(InvoiceTotalMismatchError);
        expect(error).toMatchObject({ label });
      }
    },
  );

  it('rejects a service-shaped row after the allocation header', () => {
    const pages = knownLayoutPages();
    pages[2].rows.splice(
      5,
      0,
      row(640, [40, 'Ambiguous Service'], [320, 'USD 1.00'], [410, 'USD 0.00'], [510, 'USD 1.00']),
    );

    expect(() => parseAwsInvoiceDocument({ pages, ...source })).toThrow();
  });
});
