import {
  AwsInvoiceSchema,
  type AwsInvoice,
  type AwsInvoiceService,
} from '../../aws-invoices';
import type { LayoutPage, LayoutRow } from '../pdf-layout';
import {
  AwsInvoiceParseError,
  centsToUsdNumber,
  maskAwsAccountId,
  parseAwsBillingPeriod,
  parseAwsInvoiceDate,
  parseUsdCents,
  reconcileCents,
  safeServiceName,
} from './fields';

export const KNOWN_AWS_INVOICE_PARSER_ID = 'aws-inc-consolidated-usd';
/** v2: rewritten against the real AWS consolidated invoice outline. */
export const KNOWN_AWS_INVOICE_PARSER_VERSION = 2;

const SELLER = 'Amazon Web Services, Inc.';
const SELLER_HEADING = `${SELLER} Invoice`;

/**
 * The invoice is an indent-driven outline, not a column table. Labels sit in a
 * left band at fixed indents and every amount sits in a right-hand column:
 *
 *   x=40  section heading, or a section total when it carries an amount
 *   x=50  item        (a service name, or an account label)
 *   x=60  component   (Charges / Credits / one of several tax lines)
 *   x=36  page banners, footers and legal boilerplate - ignored
 */
const AMOUNT_MIN_X = 400;
const INDENT_SECTION = 40;
const INDENT_ITEM = 50;
const INDENT_COMPONENT = 60;
/** Indents are 4pt apart (36 vs 40), so the tolerance must stay under that. */
const INDENT_TOLERANCE = 2;

const SECTION_SUMMARY = 'Summary';
const SECTION_CONSOLIDATED = 'Detail for Consolidated Bill';
const SECTION_ACTIVITY = 'Activity By Account';
const SECTION_ACCOUNT_SUMMARY = 'Summary for Linked Account';
const SECTION_ACCOUNT_DETAIL = 'Detail for Linked Account';

const TOTAL_INVOICE = 'Total for this invoice';
const TOTAL_ALLOCATED = 'Total allocated for this invoice';
const ACCOUNT_TOTAL_PATTERN =
  /^Account (\d{12}) total allocated for this invoice$/;

const CHARGES_LABEL = 'Charges';
const CREDITS_LABEL = 'Credits';
/** AWS itemizes tax under several names; they all fold into one tax figure. */
const TAX_LABELS = new Set([
  'Tax',
  'VAT',
  'GST',
  'CT',
  'ST',
  'Estimated US sales tax to be collected',
]);

const ACCOUNT_LABEL_PATTERN = /\((\d{12})\)\s*$/;
const BILLING_PERIOD_PATTERN = /This invoice is for the billing period (.+)$/;
const DUE_DATE_PATTERN = /^TOTAL AMOUNT DUE ON (.+)$/;
const INVOICE_DATE_LABEL = 'Invoice Date:';

export interface ExtractedAwsInvoiceDocument {
  pages: LayoutPage[];
}

export interface AwsInvoiceParser {
  readonly id: string;
  readonly version: number;
  canParse(document: ExtractedAwsInvoiceDocument): boolean;
  parse(
    document: ExtractedAwsInvoiceDocument & {
      sha256: string;
      uploadedAt: string;
    },
  ): AwsInvoice;
}

/** One outline item plus the components folded into it, in integer cents. */
interface ItemCents {
  label: string;
  total: number;
  charges: number;
  credits: number;
  tax: number;
}

interface AccountBlock {
  accountId: string;
  summary: ItemCents;
  declaredTotal?: number;
  services: ItemCents[];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function rowText(row: LayoutRow): string {
  return normalize(row.cells.map(({ text }) => text).join(' '));
}

/** Text left of the amount column - the outline label. */
function labelOf(row: LayoutRow): string {
  return normalize(
    row.cells
      .filter(({ x }) => x < AMOUNT_MIN_X)
      .map(({ text }) => text)
      .join(' '),
  );
}

/** Raw text of the first right-column cell, if any. */
function rightValue(row: LayoutRow): string | undefined {
  const cell = row.cells.find(({ x }) => x >= AMOUNT_MIN_X);
  return cell ? normalize(cell.text) : undefined;
}

/** Amount in cents when the right column holds a USD figure. */
function amountOf(row: LayoutRow): number | undefined {
  for (const { x, text } of row.cells) {
    if (x < AMOUNT_MIN_X) continue;
    if (!/^USD\s/.test(normalize(text))) continue;
    return parseUsdCents(text);
  }
  return undefined;
}

function indentOf(row: LayoutRow): number {
  return row.cells[0]?.x ?? -1;
}

function isIndent(row: LayoutRow, indent: number): boolean {
  return Math.abs(indentOf(row) - indent) <= INDENT_TOLERANCE;
}

/** Strip footnote markers AWS appends to tax labels ("VAT **"). */
function componentKey(label: string): string {
  return normalize(label.replace(/[*†‡\s]+$/, ''));
}

function emptyItem(label: string): ItemCents {
  return { label, total: 0, charges: 0, credits: 0, tax: 0 };
}

function hasMarker(pages: LayoutPage[], marker: string): boolean {
  return pages.some(({ rows }) =>
    rows.some((row) => rowText(row) === marker || labelOf(row) === marker),
  );
}

/** A different AWS selling entity must fail closed rather than half-parse. */
function hasConflictingSeller(pages: LayoutPage[]): boolean {
  return pages.some(({ rows }) =>
    rows.some((row) => {
      const text = rowText(row);
      return /^Amazon Web Services\b.*\bInvoice$/.test(text) &&
        text !== SELLER_HEADING;
    }),
  );
}

function findRow(
  pages: LayoutPage[],
  predicate: (row: LayoutRow) => boolean,
): LayoutRow | undefined {
  for (const { rows } of pages) {
    const match = rows.find(predicate);
    if (match) return match;
  }
  return undefined;
}

function parseHeader(pages: LayoutPage[]): {
  billingPeriod: { start: string; end: string };
  invoiceDate: string;
  dueDate: string;
  headerAmountDue: number;
} {
  const periodRow = findRow(pages, (row) =>
    BILLING_PERIOD_PATTERN.test(rowText(row)),
  );
  const period = periodRow
    ? BILLING_PERIOD_PATTERN.exec(rowText(periodRow))?.[1]
    : undefined;
  if (!period) throw new AwsInvoiceParseError('INVALID_BILLING_PERIOD');

  const invoiceDateRow = findRow(pages, (row) =>
    row.cells.some(({ text }) => normalize(text) === INVOICE_DATE_LABEL),
  );
  const invoiceDateValue = invoiceDateRow
    ? rightValue(invoiceDateRow)
    : undefined;
  if (!invoiceDateValue) throw new AwsInvoiceParseError('INVALID_INVOICE_DATE');

  const dueRow = findRow(pages, (row) =>
    row.cells.some(({ text }) => DUE_DATE_PATTERN.test(normalize(text))),
  );
  const dueCell = dueRow?.cells.find(({ text }) =>
    DUE_DATE_PATTERN.test(normalize(text)),
  );
  const dueValue = dueCell
    ? DUE_DATE_PATTERN.exec(normalize(dueCell.text))?.[1]
    : undefined;
  if (!dueValue || !dueRow) throw new AwsInvoiceParseError('INVALID_INVOICE_DATE');

  const headerAmountDue = amountOf(dueRow);
  if (headerAmountDue === undefined) {
    throw new AwsInvoiceParseError('INVALID_USD_AMOUNT');
  }

  return {
    billingPeriod: parseAwsBillingPeriod(period),
    invoiceDate: parseAwsInvoiceDate(invoiceDateValue),
    dueDate: parseAwsInvoiceDate(dueValue),
    headerAmountDue,
  };
}

interface Outline {
  summary?: ItemCents;
  invoiceTotal?: number;
  allocatedTotal?: number;
  consolidated: ItemCents[];
  activity: Map<string, ItemCents>;
  accounts: AccountBlock[];
}

/**
 * Walk the outline top to bottom. Sections persist across page boundaries so a
 * service list continued on the next page keeps appending to the same section.
 */
function readOutline(pages: LayoutPage[]): Outline {
  const outline: Outline = {
    consolidated: [],
    activity: new Map(),
    accounts: [],
  };
  let section = '';
  let current: ItemCents | undefined;
  let block: AccountBlock | undefined;

  for (const page of pages) {
    for (const row of page.rows) {
      const label = labelOf(row);
      if (!label) continue;
      const amount = amountOf(row);

      if (isIndent(row, INDENT_SECTION)) {
        current = undefined;

        if (amount !== undefined) {
          const accountTotal = ACCOUNT_TOTAL_PATTERN.exec(label);
          if (label === TOTAL_INVOICE) outline.invoiceTotal = amount;
          else if (label === TOTAL_ALLOCATED) outline.allocatedTotal = amount;
          else if (accountTotal && block) block.declaredTotal = amount;
          continue;
        }

        section = label;
        if (section === SECTION_ACCOUNT_SUMMARY) {
          block = undefined; // opened by the item row that names the account
        }
        continue;
      }

      if (isIndent(row, INDENT_ITEM)) {
        if (amount === undefined) {
          current = undefined;
          continue;
        }
        current = { ...emptyItem(label), total: amount };

        if (section === SECTION_ACTIVITY) {
          const accountId = ACCOUNT_LABEL_PATTERN.exec(label)?.[1];
          if (!accountId) throw new AwsInvoiceParseError('INVALID_ACCOUNT_ID');
          if (outline.activity.has(accountId)) {
            throw new AwsInvoiceParseError('INVALID_ACCOUNT_ID');
          }
          outline.activity.set(accountId, current);
        } else if (section === SECTION_ACCOUNT_SUMMARY) {
          const accountId = ACCOUNT_LABEL_PATTERN.exec(label)?.[1];
          if (!accountId) throw new AwsInvoiceParseError('INVALID_ACCOUNT_ID');
          block = { accountId, summary: current, services: [] };
          outline.accounts.push(block);
        } else if (section === SECTION_CONSOLIDATED) {
          current = addItem(outline.consolidated, current);
        } else if (section === SECTION_ACCOUNT_DETAIL) {
          if (!block) throw new AwsInvoiceParseError('INVALID_ACCOUNT_ID');
          current = addItem(block.services, current);
        } else if (section === SECTION_SUMMARY) {
          outline.summary = current;
        }
        continue;
      }

      if (isIndent(row, INDENT_COMPONENT)) {
        if (!current || amount === undefined) continue;
        const key = componentKey(label);
        if (key === CHARGES_LABEL) current.charges += amount;
        else if (key === CREDITS_LABEL) current.credits += amount;
        else if (TAX_LABELS.has(key)) current.tax += amount;
        else throw new AwsInvoiceParseError('UNKNOWN_COMPONENT_LABEL');
      }
      // Anything further left (banners, footers, legal text) is ignored, and
      // deliberately does not reset the section - sections span pages.
    }
  }

  return outline;
}

/**
 * Merge repeats of the same label, e.g. a section continued across pages, and
 * return the item that later component rows must accumulate into. The stored
 * object is returned by reference - components arrive after the item row.
 */
function addItem(items: ItemCents[], next: ItemCents): ItemCents {
  const existing = items.find(({ label }) => label === next.label);
  if (!existing) {
    items.push(next);
    return next;
  }
  existing.total += next.total;
  return existing;
}

function sum(items: ItemCents[], field: 'charges' | 'credits' | 'tax' | 'total'): number {
  return items.reduce((total, item) => total + item[field], 0);
}

function toService(item: ItemCents): AwsInvoiceService {
  return {
    name: safeServiceName(item.label),
    charges: centsToUsdNumber(item.charges),
    tax: centsToUsdNumber(item.tax),
    total: centsToUsdNumber(item.total),
  };
}

/** Zero-valued services reconcile, then drop out of the reported lists. */
function nonzeroServices(items: ItemCents[]): AwsInvoiceService[] {
  return items
    .filter(({ charges, tax, total }) => charges !== 0 || tax !== 0 || total !== 0)
    .map(toService);
}

export const knownAwsInvoiceParser: AwsInvoiceParser = {
  id: KNOWN_AWS_INVOICE_PARSER_ID,
  version: KNOWN_AWS_INVOICE_PARSER_VERSION,

  canParse({ pages }): boolean {
    if (pages.length === 0 || hasConflictingSeller(pages)) return false;
    return (
      hasMarker(pages, SELLER_HEADING) &&
      hasMarker(pages, 'Invoice Summary') &&
      hasMarker(pages, SECTION_CONSOLIDATED) &&
      hasMarker(pages, SECTION_ACTIVITY)
    );
  },

  parse(document): AwsInvoice {
    const { pages } = document;
    const header = parseHeader(pages);
    const outline = readOutline(pages);

    const { summary, invoiceTotal, allocatedTotal } = outline;
    if (
      !summary ||
      invoiceTotal === undefined ||
      allocatedTotal === undefined ||
      outline.consolidated.length === 0 ||
      outline.activity.size === 0
    ) {
      throw new AwsInvoiceParseError('INVALID_USD_AMOUNT');
    }

    const totals = {
      charges: summary.charges,
      credits: summary.credits,
      tax: summary.tax,
      amountDue: invoiceTotal,
    };

    // The summary block, the header banner and the allocation section each
    // state the amount due independently; all three must agree.
    reconcileCents(
      'INVOICE_AMOUNT',
      totals.amountDue,
      totals.charges - totals.credits + totals.tax,
    );
    reconcileCents('INVOICE_AMOUNT', totals.amountDue, summary.total);
    reconcileCents('INVOICE_AMOUNT', totals.amountDue, header.headerAmountDue);
    reconcileCents('LINKED_ACCOUNT_SUM', totals.amountDue, allocatedTotal);

    for (const service of outline.consolidated) {
      reconcileCents(
        'SERVICE_TOTAL',
        service.total,
        service.charges - service.credits + service.tax,
      );
    }
    reconcileCents(
      'CONSOLIDATED_CHARGES',
      totals.charges,
      sum(outline.consolidated, 'charges'),
    );
    reconcileCents('CONSOLIDATED_TAX', totals.tax, sum(outline.consolidated, 'tax'));

    const allocations = [...outline.activity.entries()];
    for (const [, allocation] of allocations) {
      reconcileCents(
        'LINKED_ACCOUNT_TOTAL',
        allocation.total,
        allocation.charges - allocation.credits + allocation.tax,
      );
    }
    reconcileCents(
      'LINKED_ACCOUNT_SUM',
      allocatedTotal,
      allocations.reduce((total, [, item]) => total + item.total, 0),
    );

    const linkedAccounts = allocations.map(([accountId, allocation]) => {
      const block = outline.accounts.find((entry) => entry.accountId === accountId);
      if (!block || block.services.length === 0) {
        throw new AwsInvoiceParseError('INVALID_ACCOUNT_ID');
      }
      if (block.declaredTotal !== undefined) {
        reconcileCents('LINKED_ACCOUNT_TOTAL', allocation.total, block.declaredTotal);
      }
      for (const service of block.services) {
        reconcileCents(
          'SERVICE_TOTAL',
          service.total,
          service.charges - service.credits + service.tax,
        );
      }
      reconcileCents(
        'LINKED_ACCOUNT_CHARGES',
        allocation.charges,
        sum(block.services, 'charges'),
      );
      reconcileCents(
        'LINKED_ACCOUNT_TAX',
        allocation.tax,
        sum(block.services, 'tax'),
      );

      return {
        // The label carries the account holder's name; only last four survives.
        accountLast4: maskAwsAccountId(accountId),
        charges: centsToUsdNumber(allocation.charges),
        credits: centsToUsdNumber(allocation.credits),
        tax: centsToUsdNumber(allocation.tax),
        total: centsToUsdNumber(allocation.total),
        services: nonzeroServices(block.services),
      };
    });

    return AwsInvoiceSchema.parse({
      seller: SELLER,
      billingPeriod: header.billingPeriod,
      invoiceDate: header.invoiceDate,
      dueDate: header.dueDate,
      currency: 'USD',
      totals: {
        charges: centsToUsdNumber(totals.charges),
        credits: centsToUsdNumber(totals.credits),
        tax: centsToUsdNumber(totals.tax),
        amountDue: centsToUsdNumber(totals.amountDue),
      },
      services: nonzeroServices(outline.consolidated),
      linkedAccounts,
      source: {
        parserId: KNOWN_AWS_INVOICE_PARSER_ID,
        parserVersion: KNOWN_AWS_INVOICE_PARSER_VERSION,
        sha256: document.sha256,
        uploadedAt: document.uploadedAt,
      },
    });
  },
};
