import { describe, expect, it } from 'vitest';

import type { AggregatedView } from '@/lib/aggregations';
import { categoryColor } from '@/lib/category-colors';
import { categoryPieSeries } from '@/app/components/charts/category-series';
import { merchantBarSeries } from '@/app/components/charts/merchant-series';
import { installmentSeries, trendSeries } from '@/app/components/charts/trend-series';

const view = {
  subPeriods: [
    { label: '1', value: 100_000 },
    { label: '2', value: 0 },
    { label: '3', value: 250_000 },
  ],
  installmentSubPeriods: [
    { label: '1', value: 0 },
    { label: '2', value: 1_500_000 },
    { label: '3', value: 0 },
  ],
} as unknown as AggregatedView;

describe('categoryPieSeries', () => {
  it('builds one donut segment per category with its category colour, in order', () => {
    expect(
      categoryPieSeries([
        { category: 'Food & Dining', value: 1_200_000 },
        { category: 'Shopping', value: 800_000 },
      ]),
    ).toEqual({
      type: 'donut',
      name: 'Spending by category',
      data: [
        { id: 'Food & Dining', name: 'Food & Dining', y: 1_200_000, color: categoryColor('Food & Dining') },
        { id: 'Shopping', name: 'Shopping', y: 800_000, color: categoryColor('Shopping') },
      ],
    });
  });

  it('returns null for no categories so the chart shows its empty state', () => {
    expect(categoryPieSeries([])).toBeNull();
  });
});

describe('merchantBarSeries', () => {
  const data = [
    { merchant: 'Shopee', value: 900_000, category: 'Shopping' },
    { merchant: 'Grab', value: 400_000, category: 'Transport' },
    { merchant: 'Lazada', value: 300_000, category: 'Shopping' },
    { merchant: 'Mystery', value: 100_000 },
  ];

  it('keeps merchants as categories in their given order', () => {
    expect(merchantBarSeries(data).categories).toEqual(['Shopee', 'Grab', 'Lazada', 'Mystery']);
  });

  it('builds one column series per spending category, aligned to the merchants', () => {
    const { series } = merchantBarSeries(data);
    expect(series.map((s) => [s.name, s.color, s.data])).toEqual([
      ['Shopping', categoryColor('Shopping'), [900_000, null, 300_000, null]],
      ['Transport', categoryColor('Transport'), [null, 400_000, null, null]],
      ['Other', categoryColor(''), [null, null, null, 100_000]],
    ]);
    expect(series.every((s) => s.type === 'column')).toBe(true);
  });

  it('returns no series for no merchants', () => {
    expect(merchantBarSeries([])).toEqual({ categories: [], series: [] });
  });
});

describe('trendSeries and installmentSeries', () => {
  it('maps spend sub-periods to one column series', () => {
    expect(trendSeries(view)).toEqual({
      categories: ['1', '2', '3'],
      series: [{ type: 'column', name: 'Spending', data: [100_000, 0, 250_000] }],
    });
  });

  it('maps installment sub-periods to one area series', () => {
    expect(installmentSeries(view)).toEqual({
      categories: ['1', '2', '3'],
      series: [{ type: 'area', name: 'Installments', data: [0, 1_500_000, 0] }],
    });
  });

  it('returns no series when there are no buckets', () => {
    const empty = { subPeriods: [], installmentSubPeriods: [] } as unknown as AggregatedView;
    expect(trendSeries(empty).series).toEqual([]);
    expect(installmentSeries(empty).series).toEqual([]);
  });
});
