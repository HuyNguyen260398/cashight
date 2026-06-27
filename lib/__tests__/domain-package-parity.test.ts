import { describe, expect, it } from 'vitest';

import { aggregate as aggregateFromDomain } from '@cashight/domain/aggregations';
import { categorize as categorizeFromDomain } from '@cashight/domain/categorize';
import {
  formatDate as formatDateFromDomain,
  formatVND as formatVNDFromDomain,
} from '@cashight/domain/format';
import { parsePeriodFromSearch as parsePeriodFromDomain } from '@cashight/domain/period';
import { StatementSchema as DomainStatementSchema } from '@cashight/domain/schemas';
import { buildSummaryPayload as buildSummaryFromDomain } from '@cashight/domain/summary-payload';
import { aggregate as aggregateFromLib } from '@/lib/aggregations';
import { categorize as categorizeFromLib } from '@/lib/categorize';
import {
  formatDate as formatDateFromLib,
  formatVND as formatVNDFromLib,
} from '@/lib/format';
import { parsePeriodFromSearch as parsePeriodFromLib } from '@/lib/period';
import { StatementSchema as LibStatementSchema } from '@/lib/schemas';
import { buildSummaryPayload as buildSummaryFromLib } from '@/lib/summary-payload';

const statementFixture = {
  bank: 'TPBank',
  cardLast4: '9674',
  statementDate: '2026-05-31',
  paymentDueDate: '2026-06-15',
  creditLimit: 100_000_000,
  totals: {
    previousBalance: 0,
    statementBalance: 1_000_000,
    minimumPayment: 50_000,
    totalSpend: 1_000_000,
    totalInstallments: 0,
    totalCashback: 0,
    totalFeesAndInterest: 0,
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
  ],
} as const;

describe('@cashight/domain compatibility', () => {
  it('parses statements identically', () => {
    expect(DomainStatementSchema.parse(statementFixture)).toEqual(
      LibStatementSchema.parse(statementFixture),
    );
  });

  it('parses periods identically', () => {
    const params = new URLSearchParams('period=quarter&year=2026&quarter=2');

    expect(parsePeriodFromDomain(params)).toEqual(parsePeriodFromLib(params));
  });

  it('aggregates statements identically', () => {
    const domainStatement = DomainStatementSchema.parse(statementFixture);
    const libStatement = LibStatementSchema.parse(statementFixture);
    const period = { type: 'month', year: 2026, month: 5 } as const;

    expect(aggregateFromDomain([domainStatement], period)).toEqual(
      aggregateFromLib([libStatement], period),
    );
  });

  it('categorizes descriptions identically', () => {
    for (const description of ['AWS', 'Netflix', 'Unknown Merchant']) {
      expect(categorizeFromDomain(description)).toBe(
        categorizeFromLib(description),
      );
    }
  });

  it('formats amounts and dates identically', () => {
    expect(formatVNDFromDomain(26_986_712)).toBe(
      formatVNDFromLib(26_986_712),
    );
    expect(formatDateFromDomain('2026-05-15')).toBe(
      formatDateFromLib('2026-05-15'),
    );
  });

  it('builds privacy-safe summary payloads identically', () => {
    const domainView = aggregateFromDomain(
      [DomainStatementSchema.parse(statementFixture)],
      { type: 'month', year: 2026, month: 5 },
    );
    const libView = aggregateFromLib(
      [LibStatementSchema.parse(statementFixture)],
      { type: 'month', year: 2026, month: 5 },
    );

    expect(buildSummaryFromDomain(domainView)).toEqual(
      buildSummaryFromLib(libView),
    );
  });
});
