import { describe, expect, it } from 'vitest';

import { aggregate } from '@cashight/domain/aggregations';
import { scrubVibDescription } from '@cashight/domain/parsers/vib-fields';
import { redactForLog } from '@cashight/domain/security/logging';
import { StatementSchema } from '@cashight/domain/schemas';
import { buildSummaryPayload } from '@cashight/domain/summary-payload';

const SENTINELS = [
  '4111111111111111',
  'HUY TEST USER',
  'PRIVATE MERCHANT DESCRIPTION',
];

function expectSentinelsAbsent(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of SENTINELS) {
    expect(serialized.includes(sentinel)).toBe(false);
  }
}

describe('hybrid architecture privacy boundaries', () => {
  it('keeps statement PII out of AI payloads and log-safe values', () => {
    const statement = StatementSchema.parse({
      bank: 'TPBank',
      cardLast4: '1111',
      statementDate: '2026-05-31',
      paymentDueDate: '2026-06-15',
      creditLimit: 100_000_000,
      totals: {
        previousBalance: 0,
        statementBalance: 1_010_000,
        minimumPayment: 50_500,
        totalSpend: 1_000_000,
        totalInstallments: 0,
        totalCashback: 0,
        totalFeesAndInterest: 10_000,
      },
      transactions: [
        {
          date: '2026-05-10',
          postingDate: '2026-05-11',
          description: 'Safe Merchant',
          currency: 'VND',
          originalAmount: 1_000_000,
          amountVnd: 1_000_000,
          category: 'Shopping',
          isInstallment: false,
          isInternational: false,
        },
        {
          date: '2026-05-12',
          postingDate: '2026-05-13',
          description:
            'HUY TEST USER PRIVATE MERCHANT DESCRIPTION 4111111111111111',
          currency: 'VND',
          originalAmount: 10_000,
          amountVnd: 10_000,
          category: 'Fees & Interest',
          isInstallment: false,
          isInternational: false,
        },
      ],
    });

    const view = aggregate([statement], { type: 'month', year: 2026, month: 5 });
    const payload = buildSummaryPayload(view);
    const logSafeStatement = redactForLog(statement);

    // The dashboard needs the balance, Gemini must never see it. The KPI card
    // reads it off the view; buildSummaryPayload builds `totals` field by field
    // precisely so a new view field cannot leak into a prompt by accident.
    expect(view.latestStatement).toEqual({
      statementBalance: 1_010_000,
      statementDate: '2026-05-31',
    });
    expect(JSON.stringify(payload)).not.toContain('1010000');
    expect(JSON.stringify(payload)).not.toContain('latestStatement');

    expect(payload.totals).toEqual({
      spend: 1_000_000,
      feesAndInterest: 10_000,
      cashback: 0,
      installments: 0,
    });
    expect(payload.topMerchants).toContainEqual({
      merchant: 'Safe Merchant',
      amount: 1_000_000,
    });
    expect(logSafeStatement).toMatchObject({
      cardLast4: '1111',
      totals: { totalSpend: 1_000_000 },
    });
    expectSentinelsAbsent(payload);
    expectSentinelsAbsent(logSafeStatement);
  });

  it('scrubs PAN, account number, and cardholder name out of VIB descriptions', () => {
    const raw =
      '526887xxxxxx4550-000000000786286 - NGUYEN GIA HUY - Thanh toan sao ke the Master Card 06/2026';
    const scrubbed = scrubVibDescription(raw);
    expect(scrubbed).not.toMatch(/\d{6}[x*]{6}\d{4}/i);
    expect(scrubbed).not.toMatch(/\b\d{9,}\b/);
    expect(scrubbed).not.toContain('NGUYEN');
  });
});
