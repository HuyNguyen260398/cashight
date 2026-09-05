import { describe, expect, it } from 'vitest';
import { hasBankDashboardContext, legacyStatementHref, statementDashboardHref } from '../lib/dashboard-routes';
import { resolveOidcCallbackReturn } from '../auth/return-to';

describe('dashboard destinations', () => {
  it.each([undefined, null, '', [], 1, {}, { returnTo: 'https://example.invalid/' }, { returnTo: '//example.invalid/' }])('uses a safe default for %j', (state) => {
    expect(resolveOidcCallbackReturn(state)).toBe('/aws/cost-explorer/');
  });
  it('preserves the exact allowlisted callback return', () => {
    expect(resolveOidcCallbackReturn({ returnTo: '/aws/cost-explorer/' })).toBe('/aws/cost-explorer/');
  });
  it.each(['bank=VIB', 'bank=unknown', 'period=quarter&year=2026&quarter=2', 'month=7'])('retains bank context in %s', (search) => {
    expect(hasBankDashboardContext(new URLSearchParams(search))).toBe(true);
  });
  it.each(['', 'utm_source=bookmark'])('uses the default dashboard for %s', (search) => {
    expect(hasBankDashboardContext(new URLSearchParams(search))).toBe(false);
  });
  it('links a statement with its bank and month', () => {
    expect(statementDashboardHref({ bank: 'VIB', year: 2026, month: 7 })).toBe('/?bank=VIB&period=month&year=2026&month=7');
  });
  it.each([
    ['', 'statement-upload', '/?bank=TPBank#statement-upload'],
    ['bank=VIB', 'statement-history', '/?bank=VIB#statement-history'],
    ['bank=invalid', 'statement-history', '/?bank=TPBank#statement-history'],
    ['period=quarter&year=2026&quarter=2', 'statement-history', '/?period=quarter&year=2026&quarter=2#statement-history'],
  ] as const)('redirects legacy query %s into its section', (search, section, expected) => {
    expect(legacyStatementHref(new URLSearchParams(search), section)).toBe(expected);
  });
});
