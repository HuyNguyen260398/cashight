import { DEFAULT_BANK, parseBankFromSearch, type BankCode } from '@/lib/banks';

export const DEFAULT_DASHBOARD_HREF = '/aws/cost-explorer/' as const;

export function hasBankDashboardContext(search: URLSearchParams): boolean {
  return ['bank', 'period', 'year', 'month', 'quarter'].some((key) => search.has(key));
}

export function statementDashboardHref(row: { bank: BankCode; year: number; month: number }): string {
  const search = new URLSearchParams({
    bank: row.bank,
    period: 'month',
    year: String(row.year),
    month: String(row.month),
  });
  return `/?${search}`;
}

export function legacyStatementHref(
  search: URLSearchParams,
  section: 'statement-upload' | 'statement-history',
): string {
  const params = new URLSearchParams(search);
  const hasPeriod = ['period', 'year', 'month', 'quarter'].some((key) => params.has(key));
  if (!parseBankFromSearch(params) && !hasPeriod) params.set('bank', DEFAULT_BANK);
  return `/?${params}#${section}`;
}
