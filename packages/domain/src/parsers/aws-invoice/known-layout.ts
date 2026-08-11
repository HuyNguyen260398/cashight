import {
  AwsInvoiceSchema,
  type AwsInvoice,
  type AwsInvoiceService,
} from '../../aws-invoices';
import type { LayoutCell, LayoutPage, LayoutRow } from '../pdf-layout';
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
export const KNOWN_AWS_INVOICE_PARSER_VERSION = 1;

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

interface ServiceCents {
  name: string;
  charges: number;
  tax: number;
  total: number;
}

interface AccountAllocationCents {
  accountId: string;
  charges: number;
  credits: number;
  tax: number;
  total: number;
}

type ParserSection =
  | { kind: 'NONE' }
  | { kind: 'CONSOLIDATED' }
  | { kind: 'ALLOCATION' }
  | { kind: 'ACCOUNT'; accountId: string };

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizedRowText(row: LayoutRow): string {
  return normalize(row.cells.map(({ text }) => text).join(' '));
}

function firstCell(row: LayoutRow): string {
  return normalize(row.cells[0]?.text ?? '');
}

function joinedCells(cells: LayoutCell[]): string {
  return normalize(cells.map(({ text }) => text).join(' '));
}

function cellsBetween(row: LayoutRow, start: number, end = Infinity): string {
  return joinedCells(row.cells.filter(({ x }) => x >= start && x < end));
}

function markerCount(pages: LayoutPage[], marker: string): number {
  return pages.flatMap(({ rows }) => rows).filter((row) => {
    const text = normalizedRowText(row);
    return text === marker || firstCell(row) === marker;
  }).length;
}

function hasConflictingSeller(pages: LayoutPage[]): boolean {
  return pages.flatMap(({ rows }) => rows).some((row) => {
    const text = normalizedRowText(row);
    return text.startsWith('Amazon Web Services') &&
      text !== 'Amazon Web Services, Inc.';
  });
}

function parseServiceRow(row: LayoutRow): ServiceCents | undefined {
  const chargesText = cellsBetween(row, 280, 390);
  const taxText = cellsBetween(row, 390, 490);
  const totalText = cellsBetween(row, 490);
  if (!chargesText && !taxText && !totalText) return undefined;
  if (!chargesText || !taxText || !totalText) {
    throw new AwsInvoiceParseError('INVALID_USD_AMOUNT');
  }

  const service: ServiceCents = {
    name: safeServiceName(cellsBetween(row, -Infinity, 280)),
    charges: parseUsdCents(chargesText),
    tax: parseUsdCents(taxText),
    total: parseUsdCents(totalText),
  };
  reconcileCents('SERVICE_TOTAL', service.total, service.charges + service.tax);
  return service;
}

function parseAllocationRow(row: LayoutRow): AccountAllocationCents | undefined {
  const accountId = cellsBetween(row, -Infinity, 250);
  const hasAmount = row.cells.some(({ text }) => /\bUSD\b/.test(text));
  if (!/^\d{12}$/.test(accountId)) {
    if (hasAmount) throw new AwsInvoiceParseError('INVALID_USD_AMOUNT');
    return undefined;
  }

  const allocation: AccountAllocationCents = {
    accountId,
    charges: parseUsdCents(cellsBetween(row, 250, 340)),
    credits: parseUsdCents(cellsBetween(row, 340, 420)),
    tax: parseUsdCents(cellsBetween(row, 420, 490)),
    total: parseUsdCents(cellsBetween(row, 490)),
  };
  reconcileCents(
    'LINKED_ACCOUNT_TOTAL',
    allocation.total,
    allocation.charges - allocation.credits + allocation.tax,
  );
  return allocation;
}

function addService(
  services: ServiceCents[],
  nextService: ServiceCents,
): void {
  const existing = services.find(({ name }) => name === nextService.name);
  if (!existing) {
    services.push(nextService);
    return;
  }
  existing.charges += nextService.charges;
  existing.tax += nextService.tax;
  existing.total += nextService.total;
}

function toService(service: ServiceCents): AwsInvoiceService {
  return {
    name: service.name,
    charges: centsToUsdNumber(service.charges),
    tax: centsToUsdNumber(service.tax),
    total: centsToUsdNumber(service.total),
  };
}

function nonzeroServices(services: ServiceCents[]): AwsInvoiceService[] {
  return services
    .filter(({ charges, tax, total }) => charges !== 0 || tax !== 0 || total !== 0)
    .map(toService);
}

function sum(services: ServiceCents[], field: 'charges' | 'tax' | 'total'): number {
  return services.reduce((total, service) => total + service[field], 0);
}

function summaryValue(rows: LayoutRow[], label: string): string {
  const matching = rows.filter((row) => firstCell(row) === label);
  if (matching.length !== 1) {
    throw new AwsInvoiceParseError('INVALID_BILLING_PERIOD');
  }
  const value = joinedCells(matching[0].cells.slice(1));
  if (!value) throw new AwsInvoiceParseError('INVALID_BILLING_PERIOD');
  return value;
}

function isExactFooter(text: string): boolean {
  return /^Page \d+ of \d+$/.test(text);
}

export const knownAwsInvoiceParser: AwsInvoiceParser = {
  id: KNOWN_AWS_INVOICE_PARSER_ID,
  version: KNOWN_AWS_INVOICE_PARSER_VERSION,

  canParse({ pages }): boolean {
    if (pages.length === 0 || hasConflictingSeller(pages)) return false;
    return (
      markerCount(pages, 'Amazon Web Services, Inc.') >= 1 &&
      markerCount(pages, 'Invoice Summary') === 1 &&
      markerCount(pages, 'Billing period') === 1 &&
      markerCount(pages, 'Detail for consolidated bill') === 1 &&
      markerCount(pages, 'Linked account allocation') === 1
    );
  },

  parse(document): AwsInvoice {
    const rows = document.pages.flatMap(({ rows }) => rows);
    const billingPeriod = parseAwsBillingPeriod(
      summaryValue(rows, 'Billing period'),
    );
    const invoiceDate = parseAwsInvoiceDate(summaryValue(rows, 'Invoice date'));
    const dueDate = parseAwsInvoiceDate(summaryValue(rows, 'Due date'));
    const totals = {
      charges: parseUsdCents(summaryValue(rows, 'Total charges')),
      credits: parseUsdCents(summaryValue(rows, 'Total credits')),
      tax: parseUsdCents(summaryValue(rows, 'Total tax')),
      amountDue: parseUsdCents(summaryValue(rows, 'Amount due')),
    };

    const consolidatedServices: ServiceCents[] = [];
    const allocations = new Map<string, AccountAllocationCents>();
    const accountServices = new Map<string, ServiceCents[]>();
    let section: ParserSection = { kind: 'NONE' };

    for (const page of document.pages) {
      for (const row of page.rows) {
        const text = normalizedRowText(row);
        if (
          !text ||
          isExactFooter(text) ||
          text === 'Amazon Web Services, Inc.' ||
          text === 'Invoice Summary'
        ) {
          continue;
        }
        if (text === 'Detail for consolidated bill') {
          section = { kind: 'CONSOLIDATED' };
          continue;
        }
        if (text === 'Linked account allocation') {
          section = { kind: 'ALLOCATION' };
          continue;
        }
        const accountHeading = /^Detail for linked account (\d{12})$/.exec(text);
        if (accountHeading) {
          section = { kind: 'ACCOUNT', accountId: accountHeading[1] };
          if (!accountServices.has(accountHeading[1])) {
            accountServices.set(accountHeading[1], []);
          }
          continue;
        }
        if (
          ['Billing period', 'Invoice date', 'Due date', 'Total charges', 'Total credits', 'Total tax', 'Amount due'].includes(
            firstCell(row),
          )
        ) {
          continue;
        }
        if (firstCell(row) === 'Service' || firstCell(row) === 'Linked account') {
          continue;
        }

        if (section.kind === 'CONSOLIDATED') {
          const service = parseServiceRow(row);
          if (service) addService(consolidatedServices, service);
        } else if (section.kind === 'ALLOCATION') {
          const allocation = parseAllocationRow(row);
          if (allocation) {
            if (allocations.has(allocation.accountId)) {
              throw new AwsInvoiceParseError('INVALID_ACCOUNT_ID');
            }
            allocations.set(allocation.accountId, allocation);
          }
        } else if (section.kind === 'ACCOUNT') {
          const service = parseServiceRow(row);
          if (service) addService(accountServices.get(section.accountId)!, service);
        }
      }
    }

    if (consolidatedServices.length === 0 || allocations.size === 0) {
      throw new AwsInvoiceParseError('INVALID_USD_AMOUNT');
    }

    reconcileCents(
      'CONSOLIDATED_CHARGES',
      totals.charges,
      sum(consolidatedServices, 'charges'),
    );
    reconcileCents(
      'CONSOLIDATED_TAX',
      totals.tax,
      sum(consolidatedServices, 'tax'),
    );
    reconcileCents(
      'INVOICE_AMOUNT',
      totals.amountDue,
      totals.charges - totals.credits + totals.tax,
    );
    reconcileCents(
      'LINKED_ACCOUNT_SUM',
      totals.amountDue,
      [...allocations.values()].reduce((total, account) => total + account.total, 0),
    );

    const linkedAccounts = [...allocations.values()].map((allocation) => {
      const services = accountServices.get(allocation.accountId);
      if (!services || services.length === 0) {
        throw new AwsInvoiceParseError('INVALID_ACCOUNT_ID');
      }
      reconcileCents(
        'LINKED_ACCOUNT_CHARGES',
        allocation.charges,
        sum(services, 'charges'),
      );
      reconcileCents(
        'LINKED_ACCOUNT_TAX',
        allocation.tax,
        sum(services, 'tax'),
      );
      return {
        accountLast4: maskAwsAccountId(allocation.accountId),
        charges: centsToUsdNumber(allocation.charges),
        credits: centsToUsdNumber(allocation.credits),
        tax: centsToUsdNumber(allocation.tax),
        total: centsToUsdNumber(allocation.total),
        services: nonzeroServices(services),
      };
    });

    return AwsInvoiceSchema.parse({
      seller: 'Amazon Web Services, Inc.',
      billingPeriod,
      invoiceDate,
      dueDate,
      currency: 'USD',
      totals: {
        charges: centsToUsdNumber(totals.charges),
        credits: centsToUsdNumber(totals.credits),
        tax: centsToUsdNumber(totals.tax),
        amountDue: centsToUsdNumber(totals.amountDue),
      },
      services: nonzeroServices(consolidatedServices),
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
