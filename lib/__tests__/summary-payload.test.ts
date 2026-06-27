import { describe, expect, it } from 'vitest';

import type { AggregatedView } from '@cashight/domain/aggregations';
import { buildSummaryPayload } from '@cashight/domain/summary-payload';

function view(overrides: Partial<AggregatedView> = {}): AggregatedView {
  return {
    spec: { type: 'month', year: 2026, month: 5 },
    label: '2026-05',
    statementCount: 1,
    totals: {
      totalSpend: 1000,
      totalInstallments: 0,
      totalCashback: 0,
      totalFeesAndInterest: 0,
    },
    transactions: [
      {
        date: '2026-05-01',
        postingDate: '2026-05-02',
        description: 'RAW PRIVATE MERCHANT 4987961234569674',
        currency: 'VND',
        originalAmount: 1000,
        amountVnd: 1000,
        category: 'Shopping',
        isInstallment: false,
        isInternational: true,
      },
    ],
    byCategory: [{ category: 'Shopping', value: 1000, pct: 1 }],
    topMerchants: [{ merchant: 'Safe Merchant', value: 1000 }],
    subPeriods: [{ label: '1', value: 1000 }],
    installmentSubPeriods: [],
    ...overrides,
  };
}

describe('buildSummaryPayload', () => {
  it('does not include raw transactions or card/statement fields', () => {
    const payload = buildSummaryPayload(
      {
        ...view(),
        cardLast4: '9674',
        creditLimit: 100000000,
        statementBalance: 9000000,
      } as AggregatedView,
    );

    const json = JSON.stringify(payload);
    expect(json).not.toContain('RAW PRIVATE MERCHANT');
    expect(json).not.toContain('4987961234569674');
    expect(json).not.toContain('cardLast4');
    expect(json).not.toContain('creditLimit');
    expect(json).not.toContain('statementBalance');
  });

  it('sanitizes long and control-character labels', () => {
    const longMerchant = `MERCHANT\n${'x'.repeat(200)}`;
    const payload = buildSummaryPayload(
      view({
        byCategory: [{ category: `Cat\t${'y'.repeat(200)}`, value: 1000, pct: 1 }],
        topMerchants: [{ merchant: longMerchant, value: 1000 }],
      }),
    );

    expect(payload.topCategories[0].category).not.toMatch(/[\x00-\x1F\x7F]/);
    expect(payload.topCategories[0].category).toHaveLength(120);
    expect(payload.topMerchants[0].merchant).not.toMatch(/[\x00-\x1F\x7F]/);
    expect(payload.topMerchants[0].merchant).toHaveLength(120);
  });
});
