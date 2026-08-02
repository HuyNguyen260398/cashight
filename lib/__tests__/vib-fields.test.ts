import { describe, expect, it } from 'vitest';

import {
  isDdMmYyyy,
  isVibAmount,
  parseVibAmount,
  scrubVibDescription,
  toIsoDate,
} from '@cashight/domain/parsers/vib-fields';

describe('parseVibAmount', () => {
  it('parses the comma-thousands, dot-decimal format to integer VND', () => {
    expect(parseVibAmount('5,591,567.00')).toBe(5_591_567);
  });

  it('preserves a negative sign (VIB prints credits negative)', () => {
    expect(parseVibAmount('-5,591,567.00')).toBe(-5_591_567);
  });

  it('rounds a fractional dong to the nearest integer', () => {
    expect(parseVibAmount('9,900.60')).toBe(9_901);
  });

  it('parses a value with no thousands separator', () => {
    expect(parseVibAmount('9900.00')).toBe(9_900);
  });

  it('throws on a non-numeric token', () => {
    expect(() => parseVibAmount('Thu Nợ Tối Thiểu')).toThrow();
  });
});

describe('isVibAmount', () => {
  it('accepts amounts and rejects dates and text', () => {
    expect(isVibAmount('124,000,000.00')).toBe(true);
    expect(isVibAmount('-5,591,567.00')).toBe(true);
    expect(isVibAmount('25/07/2026')).toBe(false);
    expect(isVibAmount('657704060067301')).toBe(false);
    expect(isVibAmount('3.38%/tháng')).toBe(false);
  });
});

describe('isDdMmYyyy / toIsoDate', () => {
  it('recognises and converts a VIB date', () => {
    expect(isDdMmYyyy('25/07/2026')).toBe(true);
    expect(isDdMmYyyy('2026-07-25')).toBe(false);
    expect(toIsoDate('25/07/2026')).toBe('2026-07-25');
    expect(toIsoDate('01/07/2026')).toBe('2026-07-01');
  });
});

describe('scrubVibDescription', () => {
  it('reduces a card-repayment row to a plain payment label', () => {
    expect(
      scrubVibDescription(
        '526887xxxxxx4550-000000000786286 - NGUYEN GIA HUY - Thanh toan sao ke the Master Card 06/2026',
      ),
    ).toBe('Thanh toan sao ke the');
  });

  it('removes an embedded masked PAN from a fee row', () => {
    expect(
      scrubVibDescription('Phi dich vu SMS The 526887******4550 THANG 072026'),
    ).toBe('Phi dich vu SMS The THANG 072026');
  });

  it('removes a bare card-account number', () => {
    expect(scrubVibDescription('GD TAI 000000000786286 SHOP')).toBe('GD TAI SHOP');
  });

  it('leaves a clean merchant description untouched', () => {
    expect(scrubVibDescription('GD GOC TRA GOP KY HAN 3/12 TAI CELLPHONES')).toBe(
      'GD GOC TRA GOP KY HAN 3/12 TAI CELLPHONES',
    );
  });
});
