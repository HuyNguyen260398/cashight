/**
 * Vitest suite for @cashight/domain/parsers/vib.
 *
 * The synthetic-layout tests always run. The real-fixture acceptance test is
 * skipped when test-pdfs/ is absent (it is gitignored), so CI stays green.
 */

import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  parseVIBStatement,
  parseVibStatementFromLayout,
} from '@cashight/domain/parsers/vib';
import type { LayoutPage } from '@cashight/domain/parsers/pdf-layout';
import type { Statement } from '@cashight/domain/schemas';

const pdfPath = path.resolve(__dirname, '../../test-pdfs/vib_saoke_07_2026_4550.pdf');
const hasFixture = fs.existsSync(pdfPath);
const PDF_PASSWORD = '26034550';

/** A minimal but structurally faithful stand-in for the real July 2026 page. */
function syntheticPages(): LayoutPage[] {
  const row = (y: number, cells: Array<[number, string]>) => ({
    y,
    cells: cells.map(([x, text]) => ({ x, text })),
  });
  return [
    {
      pageNumber: 1,
      rows: [
        row(664, [
          [30, 'Số thẻ chính'],
          [82, '(Primary Card Number)'],
          [213, '526887******4550'],
        ]),
        row(624, [
          [30, 'Hạn mức tín dụng'],
          [101, '(Credit Limit)'],
          [220, '124,000,000.00'],
        ]),
        row(604, [
          [30, 'Hạn mức tín dụng dự phòng'],
          [140, '(Extra Limit)'],
          [229, '6,200,000.00'],
        ]),
        row(524, [
          [30, 'Ngày sao kê'],
          [78, '(Statement Date)'],
          [236, '25/07/2026'],
          [289, 'Dư nợ kỳ trước (VND)'],
          [377, '(Previous Balance)'],
          [518, '5,591,567.00'],
        ]),
        row(504, [
          [30, 'Ngày đến hạn thanh toán'],
          [129, '(Payment Due Date)'],
          [236, '10/08/2026'],
          [289, 'Phát sinh nợ trong kỳ (VND)'],
          [399, '(Total Debit Transaction)'],
          [518, '5,591,567.00'],
        ]),
        row(464, [
          [30, 'Số TK trích nợ'],
          [87, '(Auto Debit Account)'],
          [209, '657704060067301'],
          [289, 'Dư nợ cuối kỳ (VND)'],
          [371, '(End Balance)'],
          [518, '5,591,567.00'],
        ]),
        row(444, [
          [289, 'Thanh toán tối thiểu (VND)'],
          [395, '(Minimum Payment Due)'],
          [518, '5,582,360.00'],
        ]),
        row(414, [
          [30, 'Chi tiết giao dịch'],
          [101, '(Transaction info)'],
        ]),
        row(363, [
          [30, 'Số thẻ / Số tài khoản'],
          [172, '000000000786286'],
        ]),
        row(336, [
          [30, '01/07/2026'],
          [101, '01/07/2026'],
          [172, '526887xxxxxx4550-000000000786286 - NGUYEN'],
          [362, '6012-Member Financial'],
          [516, '-5,591,567.00'],
        ]),
        row(326, [[172, 'GIA HUY - Thanh toan sao ke the Master Card']]),
        row(317, [[172, '06/2026']]),
        row(277, [
          [30, '11/05/2026'],
          [101, '11/07/2026'],
          [172, 'GD GOC TRA GOP KY HAN 3/12 TAI'],
          [518, '5,581,667.00'],
        ]),
        row(267, [[172, 'CELLPHONES']]),
        row(258, [
          [30, '25/07/2026'],
          [101, '25/07/2026'],
          [172, 'Phi dich vu SMS The 526887******4550 THANG'],
          [534, '9,900.00'],
        ]),
        row(248, [[172, '072026']]),
        row(232, [
          [30, 'Phát sinh nợ trong kỳ (VND)'],
          [139, '(Total Debit Transaction)'],
          [518, '5,591,567.00'],
        ]),
      ],
    },
  ];
}

describe('parseVibStatementFromLayout', () => {
  const stmt = parseVibStatementFromLayout(syntheticPages());

  it('reports the bank as VIB', () => {
    expect(stmt.bank).toBe('VIB');
  });

  it('derives cardLast4 from the already-masked primary card number', () => {
    expect(stmt.cardLast4).toBe('4550');
  });

  it('reads the header dates', () => {
    expect(stmt.statementDate).toBe('2026-07-25');
    expect(stmt.paymentDueDate).toBe('2026-08-10');
  });

  it('reads the credit limit, not the extra limit', () => {
    expect(stmt.creditLimit).toBe(124_000_000);
  });

  it('reads the balances, ignoring the auto-debit account number', () => {
    expect(stmt.totals.previousBalance).toBe(5_591_567);
    expect(stmt.totals.statementBalance).toBe(5_591_567);
    expect(stmt.totals.minimumPayment).toBe(5_582_360);
  });

  it('splits debits into spend, installments, and fees', () => {
    expect(stmt.totals.totalSpend).toBe(0);
    expect(stmt.totals.totalInstallments).toBe(5_581_667);
    expect(stmt.totals.totalFeesAndInterest).toBe(9_900);
    expect(stmt.totals.totalCashback).toBe(0);
  });

  it('returns one transaction per dated row, skipping card sub-headers', () => {
    expect(stmt.transactions).toHaveLength(3);
  });

  it('signs credits negative and debits positive', () => {
    expect(stmt.transactions[0].amountVnd).toBe(-5_591_567);
    expect(stmt.transactions[1].amountVnd).toBe(5_581_667);
  });

  it('folds wrapped description lines into the transaction above', () => {
    expect(stmt.transactions[1].description).toContain('CELLPHONES');
  });

  it('scrubs the cardholder name and PAN out of descriptions', () => {
    const serialized = JSON.stringify(stmt.transactions);
    expect(serialized).not.toContain('NGUYEN');
    expect(serialized).not.toContain('4550-');
    expect(serialized).not.toContain('786286');
  });

  it('flags the installment row', () => {
    expect(stmt.transactions[1].isInstallment).toBe(true);
    expect(stmt.transactions[1].category).toBe('Installments');
  });

  it('throws when the debit total does not reconcile', () => {
    const pages = syntheticPages();
    const summary = pages[0].rows.find((r) =>
      r.cells.some((c) => c.text.startsWith('Phát sinh nợ trong kỳ')),
    )!;
    // Also corrupt the header copy so both occurrences disagree with the rows.
    for (const page of pages) {
      for (const r of page.rows) {
        for (const c of r.cells) {
          if (c.text === '5,591,567.00' && c.x >= 450) c.text = '9,999,999.00';
        }
      }
    }
    expect(summary).toBeDefined();
    expect(() => parseVibStatementFromLayout(pages)).toThrow(/reconcile/i);
  });
});

describe.skipIf(!hasFixture)('parseVIBStatement — real fixture', () => {
  let stmt: Statement;

  beforeAll(async () => {
    stmt = await parseVIBStatement(fs.readFileSync(pdfPath), PDF_PASSWORD);
  });

  it('matches the July 2026 acceptance numbers', () => {
    expect(stmt.bank).toBe('VIB');
    expect(stmt.cardLast4).toBe('4550');
    expect(stmt.statementDate).toBe('2026-07-25');
    expect(stmt.paymentDueDate).toBe('2026-08-10');
    expect(stmt.creditLimit).toBe(124_000_000);
    expect(stmt.totals.previousBalance).toBe(5_591_567);
    expect(stmt.totals.statementBalance).toBe(5_591_567);
    expect(stmt.totals.minimumPayment).toBe(5_582_360);
    expect(stmt.totals.totalSpend).toBe(0);
    expect(stmt.totals.totalInstallments).toBe(5_581_667);
    expect(stmt.totals.totalFeesAndInterest).toBe(9_900);
    expect(stmt.totals.totalCashback).toBe(0);
    expect(stmt.transactions).toHaveLength(3);
  });

  it('never leaks a PAN or the cardholder name', () => {
    const serialized = JSON.stringify(stmt);
    expect(serialized).not.toMatch(/\d{6}[x*]{6}\d{4}/i);
    expect(serialized).not.toContain('NGUYEN');

    // The long-digit-run check applies to descriptions only: numeric fields
    // legitimately reach nine digits (creditLimit is 124000000).
    for (const txn of stmt.transactions) {
      expect(txn.description).not.toMatch(/\d{9,}/);
    }
  });
});
