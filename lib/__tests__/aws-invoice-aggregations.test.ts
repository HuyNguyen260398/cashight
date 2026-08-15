import { describe, expect, it } from 'vitest';
import type {
  AwsInvoice,
  AwsInvoiceMetadata,
} from '@cashight/domain/aws-invoices';
import { aggregateAwsInvoiceDashboard } from '@cashight/domain/aws-invoice-aggregations';

const selected: AwsInvoice = {
  seller: 'Amazon Web Services, Inc.',
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD',
  totals: { charges: 180, credits: 10, tax: 18, amountDue: 188 },
  services: [
    { name: 'zeta service', charges: 50, tax: 5, total: 55 },
    { name: 'Alpha Service', charges: 50, tax: 5, total: 55 },
    { name: 'Large Service', charges: 80, tax: 8, total: 88 },
  ],
  linkedAccounts: [
    {
      accountLast4: '1111',
      charges: 100,
      credits: 10,
      tax: 10,
      total: 100,
      services: [{ name: 'Large Service', charges: 100, tax: 10, total: 110 }],
    },
    {
      accountLast4: '2222',
      charges: 80,
      credits: 0,
      tax: 8,
      total: 88,
      services: [{ name: 'Alpha Service', charges: 80, tax: 8, total: 88 }],
    },
  ],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: 'a'.repeat(64),
    uploadedAt: '2026-08-03T00:00:00.000Z',
  },
};

function metadata(yearMonth: string, amountDue: number): AwsInvoiceMetadata {
  return {
    yearMonth,
    objectKey: `users/primary/aws-invoices/${yearMonth.slice(0, 4)}/${yearMonth}.json`,
    currency: 'USD',
    amountDue,
    tax: 1,
    serviceCount: 1,
    linkedAccountCount: 1,
    sha256: 'b'.repeat(64),
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    uploadedAt: '2026-08-03T00:00:00.000Z',
  };
}

describe('aggregateAwsInvoiceDashboard', () => {
  it('calculates all KPI and chart arrays with literal financial values', () => {
    const dashboard = aggregateAwsInvoiceDashboard(selected, [
      metadata('2026-07', 188),
      metadata('2026-05', 150),
      metadata('2026-06', 170),
    ]);

    expect(dashboard.yearMonth).toBe('2026-07');
    expect(dashboard.kpis).toEqual({
      amountDue: 188,
      serviceCharges: 180,
      credits: 10,
      tax: 18,
      linkedAccountCount: 2,
      billedServiceCount: 3,
    });
    expect(dashboard.chargeComposition).toEqual([
      { name: 'Charges', value: 180 },
      { name: 'Credits', value: 10 },
      { name: 'Tax', value: 18 },
    ]);
    expect(dashboard.accountAllocations).toEqual([
      { accountLast4: '1111', value: 100, percentage: 53.19 },
      { accountLast4: '2222', value: 88, percentage: 46.81 },
    ]);
    expect(dashboard.monthlyTrend).toEqual([
      { yearMonth: '2026-05', value: 150 },
      { yearMonth: '2026-06', value: 170 },
      { yearMonth: '2026-07', value: 188 },
    ]);
  });

  it('sorts service totals descending and breaks ties by normalized label', () => {
    const dashboard = aggregateAwsInvoiceDashboard(selected, []);

    expect(dashboard.serviceDetails.map(({ name }) => name)).toEqual([
      'Large Service',
      'Alpha Service',
      'zeta service',
    ]);
    expect(dashboard.serviceBreakdown).toEqual([
      { name: 'Large Service', value: 88, percentage: 44.44 },
      { name: 'Alpha Service', value: 55, percentage: 27.78 },
      { name: 'zeta service', value: 55, percentage: 27.78 },
    ]);
    expect(dashboard.topServices).toEqual(dashboard.serviceBreakdown);
  });

  it('handles zero denominators without NaN or Infinity', () => {
    const zeroInvoice: AwsInvoice = {
      ...selected,
      totals: { charges: 0, credits: 0, tax: 0, amountDue: 0 },
      services: [{ name: 'Free Tier', charges: 0, tax: 0, total: 0 }],
      linkedAccounts: [
        {
          accountLast4: '1111',
          charges: 0,
          credits: 0,
          tax: 0,
          total: 0,
          services: [{ name: 'Free Tier', charges: 0, tax: 0, total: 0 }],
        },
      ],
    };

    const dashboard = aggregateAwsInvoiceDashboard(zeroInvoice, []);

    expect(dashboard.serviceBreakdown[0].percentage).toBe(0);
    expect(dashboard.accountAllocations[0].percentage).toBe(0);
  });
});
