import type { StatementListItem } from '@/frontend/api/contracts';
import type { BankCode } from '@/lib/banks';

/**
 * Builds the URL the dashboard redirects to when it loads without a period.
 *
 * Two things this must not do, both of which were real bugs:
 *  - Rebuild the query string from scratch. The nav's `/?bank=TPBank` links
 *    carry no period, so this redirect is what runs right after clicking them;
 *    starting from an empty `URLSearchParams` silently dropped the bank filter.
 *  - Pick `items[0]`. The statements list is newest-first across *all* banks,
 *    so an explicitly requested bank would land on a month owned by the other
 *    bank and render empty.
 *
 * Returns `null` when there are no statements at all — the caller then shows
 * the empty state instead of navigating.
 */
export function initialPeriodHref(
  items: StatementListItem[],
  search: string,
  bank: BankCode | null,
): string | null {
  if (items.length === 0) return null;

  // An explicit ?bank= is always honoured, so when the requested bank has no
  // statements we still keep it and fall back to the newest month overall.
  const forBank = bank ? items.filter((i) => i.bank === bank) : items;
  const candidates = forBank.length > 0 ? forBank : items;

  // Max by date rather than trusting the API's ordering.
  const latest = candidates.reduce((a, b) =>
    b.statementDate > a.statementDate ? b : a,
  );
  const [year, month] = latest.statementDate.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;

  // Start from the current URL so the bank filter survives, matching how
  // `PeriodSelector` preserves params. `quarter` would be stale against the
  // month period written below.
  const params = new URLSearchParams(search);
  params.delete('quarter');
  params.set('period', 'month');
  params.set('year', String(year));
  params.set('month', String(month));
  return `/?${params}`;
}
