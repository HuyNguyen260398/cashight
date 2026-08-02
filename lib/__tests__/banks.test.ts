import { describe, expect, it } from 'vitest';

import {
  BANK_CODES,
  DEFAULT_BANK,
  bankShortName,
  detectBank,
  isBankCode,
  parseBankFromSearch,
  resolveBank,
} from '@cashight/domain/banks';

describe('detectBank', () => {
  it('detects TPBank from its card-type marker', () => {
    expect(detectBank('Loai the\nCard Type TPBANK CREDIT CARD Thanh toan')).toBe(
      'TPBank',
    );
  });

  it('detects VIB from its footer marker', () => {
    expect(
      detectBank('Vietnam International Bank | Tel: +84 24 62585858'),
    ).toBe('VIB');
  });

  it('detects VIB from its statement title', () => {
    expect(detectBank('Sao kê giao dịch thẻ tín dụng VIB')).toBe('VIB');
  });

  it('returns null for an unrecognised statement', () => {
    expect(detectBank('SOME OTHER BANK MONTHLY STATEMENT')).toBeNull();
  });
});

describe('bankShortName', () => {
  it('maps TPBank to TPB', () => {
    expect(bankShortName('TPBank')).toBe('TPB');
  });

  it('maps VIB to VIB', () => {
    expect(bankShortName('VIB')).toBe('VIB');
  });

  it('covers every bank code', () => {
    for (const code of BANK_CODES) {
      expect(bankShortName(code).length).toBeGreaterThan(0);
    }
  });
});

describe('isBankCode', () => {
  it('accepts known codes and rejects everything else', () => {
    expect(isBankCode('VIB')).toBe(true);
    expect(isBankCode('TPBank')).toBe(true);
    expect(isBankCode('TPB')).toBe(false);
    expect(isBankCode(undefined)).toBe(false);
  });
});

describe('parseBankFromSearch', () => {
  // null means "the URL did not choose" — which bank to show then depends on
  // what the period actually holds, so only the aggregation can decide.
  it('returns null when the param is absent', () => {
    expect(parseBankFromSearch(new URLSearchParams())).toBeNull();
  });

  it('returns null for an unknown value', () => {
    expect(parseBankFromSearch(new URLSearchParams('bank=Sacombank'))).toBeNull();
  });

  it('returns the code for a known value', () => {
    expect(parseBankFromSearch(new URLSearchParams('bank=VIB'))).toBe('VIB');
  });
});

describe('resolveBank', () => {
  it('honours an explicit choice even when that bank has no statements', () => {
    expect(resolveBank('VIB', ['TPBank'])).toBe('VIB');
  });

  it('prefers the default bank when it has statements in the period', () => {
    expect(resolveBank(null, ['TPBank', 'VIB'])).toBe(DEFAULT_BANK);
  });

  it('falls back to whichever bank has statements when the default has none', () => {
    expect(resolveBank(null, ['VIB'])).toBe('VIB');
  });

  it('falls back to the default bank for an empty period', () => {
    expect(resolveBank(null, [])).toBe(DEFAULT_BANK);
  });

  it('always returns a valid bank code', () => {
    for (const available of [[], ['VIB'], ['TPBank', 'VIB']] as const) {
      expect(isBankCode(resolveBank(null, [...available]))).toBe(true);
    }
  });
});

describe('DEFAULT_BANK', () => {
  it('is TPBank', () => {
    expect(DEFAULT_BANK).toBe('TPBank');
  });

  it('is a valid bank code', () => {
    expect(isBankCode(DEFAULT_BANK)).toBe(true);
  });
});
