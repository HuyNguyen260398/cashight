import { describe, expect, it } from 'vitest';

import { categorize } from '@cashight/domain/categorize';

describe('categorize — VIB markers', () => {
  it('classifies a VIB installment row', () => {
    expect(categorize('GD GOC TRA GOP KY HAN 3/12 TAI CELLPHONES')).toBe(
      'Installments',
    );
  });

  it('classifies a VIB service fee', () => {
    expect(categorize('Phi dich vu SMS The THANG 072026')).toBe('Fees & Interest');
  });

  it('classifies a VIB card repayment', () => {
    expect(categorize('Thanh toan sao ke the')).toBe('Payment');
  });

  it('still classifies the TPBank equivalents', () => {
    expect(categorize('Giao dich tra gop SHOPEE')).toBe('Installments');
    expect(categorize('Phi xu ly GD quoc te')).toBe('Fees & Interest');
    expect(categorize('TT QUA TPBANK EBANK')).toBe('Payment');
  });
});
