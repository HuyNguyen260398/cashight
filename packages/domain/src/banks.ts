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

/** The bank shown when the URL does not name one. */
export const DEFAULT_BANK: BankCode = 'TPBank';

/**
 * Read the dashboard bank filter out of the URL.
 *
 * The dashboard always views exactly one bank — there is no combined view — so
 * this never returns null: absent or unrecognised falls back to DEFAULT_BANK,
 * the same forgiving contract as parsePeriodFromSearch.
 */
export function parseBankFromSearch(params: URLSearchParams): BankCode {
  const raw = params.get('bank');
  return isBankCode(raw) ? raw : DEFAULT_BANK;
}
