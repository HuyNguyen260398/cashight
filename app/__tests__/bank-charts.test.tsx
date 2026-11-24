// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let highcharts: object | null = null;
vi.mock('@/app/components/charts/use-highcharts', () => ({
  useHighcharts: () => highcharts,
}));

import type { AggregatedView } from '@/lib/aggregations';
import { CategoryPie } from '@/app/components/category-pie';
import { MerchantBar } from '@/app/components/merchant-bar';
import { TrendChart } from '@/app/components/trend-chart';
import { InstallmentAreaChart } from '@/app/components/installment-area-chart';

const view = {
  subPeriods: [{ label: '1', value: 10 }],
  installmentSubPeriods: [{ label: '1', value: 5 }],
} as unknown as AggregatedView;

afterEach(() => {
  cleanup();
  highcharts = null;
});

describe('bank charts while Highcharts loads', () => {
  it.each([
    ['CategoryPie', () => <CategoryPie data={[{ category: 'Shopping', value: 1 }]} />],
    ['MerchantBar', () => <MerchantBar data={[{ merchant: 'Shopee', value: 1, category: 'Shopping' }]} />],
    ['TrendChart', () => <TrendChart view={view} />],
    ['InstallmentAreaChart', () => <InstallmentAreaChart view={view} />],
  ])('%s shows a loading status', (_name, renderChart) => {
    render(renderChart());
    expect(screen.getByText('Loading chart')).toBeInTheDocument();
  });
});

describe('bank charts with no data', () => {
  it('CategoryPie shows the empty state', () => {
    highcharts = {};
    render(<CategoryPie data={[]} />);
    expect(screen.getByText('No spending in this period')).toBeInTheDocument();
  });

  it('MerchantBar shows the empty state', () => {
    highcharts = {};
    render(<MerchantBar data={[]} />);
    expect(screen.getByText('No spending in this period')).toBeInTheDocument();
  });
});
