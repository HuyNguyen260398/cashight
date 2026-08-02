/**
 * The single place that knows which banks Cashight supports.
 *
 * `code` is the value persisted in statement JSON (S3) — never change an
 * existing one without a data migration. `shortName` is display-only.
 * `detect` is matched against the plain text extracted from an uploaded PDF.
 */

export const BANK_CODES = ['TPBank', 'VIB'] as const;
export type BankCode = (typeof BANK_CODES)[number];

interface BankProfile {
  code: BankCode;
  shortName: string;
  detect: RegExp;
}

const BANK_PROFILES: readonly BankProfile[] = [
  {
    code: 'TPBank',
    shortName: 'TPB',
    detect: /TPBANK CREDIT CARD/i,
  },
  {
    code: 'VIB',
    shortName: 'VIB',
    detect: /Vietnam International Bank|Sao kê giao dịch thẻ tín dụng VIB/i,
  },
];

/** Identify the issuing bank from extracted PDF text; null when unrecognised. */
export function detectBank(text: string): BankCode | null {
  for (const profile of BANK_PROFILES) {
    if (profile.detect.test(text)) return profile.code;
  }
  return null;
}

/** Display label for a bank code (e.g. 'TPBank' -> 'TPB'). */
export function bankShortName(code: BankCode): string {
  const profile = BANK_PROFILES.find((p) => p.code === code);
  return profile ? profile.shortName : code;
}

export function isBankCode(value: unknown): value is BankCode {
  return (
    typeof value === 'string' && (BANK_CODES as readonly string[]).includes(value)
  );
}

/** Preferred bank when the URL does not name one and that bank has data. */
export const DEFAULT_BANK: BankCode = 'TPBank';

/**
 * Read the dashboard bank filter out of the URL.
 *
 * Returns null when the URL does not choose one. Null is NOT "all banks" — the
 * dashboard always views exactly one bank — it means "not chosen yet", and
 * which bank to show then depends on what the period actually holds. Only the
 * aggregation knows that, so `resolveBank` finishes the job there.
 */
export function parseBankFromSearch(params: URLSearchParams): BankCode | null {
  const raw = params.get('bank');
  return isBankCode(raw) ? raw : null;
}

/**
 * Decide which single bank a view shows.
 *
 * An explicit request always wins, even when that bank has no statements this
 * period — the user asked for it, and "no VIB statements in August" is a real
 * answer worth showing rather than silently switching banks underneath them.
 *
 * Otherwise prefer DEFAULT_BANK when it has data, else the first bank that
 * does, so landing on the dashboard never shows an empty view when some bank
 * has statements. `available` is expected pre-sorted (as `aggregate` builds it)
 * so the fallback is deterministic.
 */
export function resolveBank(
  requested: BankCode | null,
  available: BankCode[],
): BankCode {
  if (requested) return requested;
  if (available.includes(DEFAULT_BANK)) return DEFAULT_BANK;
  return available[0] ?? DEFAULT_BANK;
}
