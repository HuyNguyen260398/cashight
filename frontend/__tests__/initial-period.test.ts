import { describe, expect, it } from 'vitest';
import { initialPeriodHref } from '@/frontend/lib/initial-period';
import type { StatementListItem } from '@/frontend/api/contracts';

function item(
  bank: 'TPBank' | 'VIB',
  statementDate: string,
): StatementListItem {
  return {
    statementId: `${bank}-${statementDate}`,
    cardLast4: bank === 'VIB' ? '4550' : '9674',
    bank,
    statementDate,
    totalSpend: 0,
    transactionCount: 0,
    uploadedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('initialPeriodHref', () => {
  it('keeps the bank filter when redirecting to the latest month', () => {
    expect(
      initialPeriodHref([item('TPBank', '2026-05-20')], 'bank=TPBank', 'TPBank'),
    ).toBe('/?bank=TPBank&period=month&year=2026&month=5');
  });

  it('picks the latest month of the requested bank, not the global latest', () => {
    const items = [item('VIB', '2026-07-25'), item('TPBank', '2026-05-20')];
    expect(initialPeriodHref(items, 'bank=TPBank', 'TPBank')).toBe(
      '/?bank=TPBank&period=month&year=2026&month=5',
    );
    expect(initialPeriodHref(items, 'bank=VIB', 'VIB')).toBe(
      '/?bank=VIB&period=month&year=2026&month=7',
    );
  });

  it('uses the newest statement of any bank when the URL names none', () => {
    const items = [item('VIB', '2026-07-25'), item('TPBank', '2026-05-20')];
    expect(initialPeriodHref(items, '', null)).toBe(
      '/?period=month&year=2026&month=7',
    );
  });

  it('does not depend on the order the API returned items in', () => {
    const items = [item('TPBank', '2026-01-20'), item('TPBank', '2026-05-20')];
    expect(initialPeriodHref(items, '', null)).toBe(
      '/?period=month&year=2026&month=5',
    );
  });

  it('honours a bank with no statements by keeping it on the global latest month', () => {
    // An explicit ?bank= is always honoured; the dashboard then shows the
    // empty-period state for that bank rather than silently switching banks.
    expect(
      initialPeriodHref([item('TPBank', '2026-05-20')], 'bank=VIB', 'VIB'),
    ).toBe('/?bank=VIB&period=month&year=2026&month=5');
  });

  it('preserves unrelated params and clears a stale quarter', () => {
    expect(
      initialPeriodHref(
        [item('TPBank', '2026-05-20')],
        'bank=TPBank&quarter=3&foo=bar',
        'TPBank',
      ),
    ).toBe('/?bank=TPBank&foo=bar&period=month&year=2026&month=5');
  });

  it('returns null when there are no statements at all', () => {
    expect(initialPeriodHref([], 'bank=TPBank', 'TPBank')).toBeNull();
  });
});
