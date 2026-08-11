// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';

import { InvoiceKpiCards } from '@/app/components/aws-invoices/invoice-kpi-cards';
import { InvoiceServicePie } from '@/app/components/aws-invoices/invoice-service-pie';
import { InvoiceTopServices } from '@/app/components/aws-invoices/invoice-top-services';
import { InvoiceTaxComposition } from '@/app/components/aws-invoices/invoice-tax-composition';
import { InvoiceAccountAllocation } from '@/app/components/aws-invoices/invoice-account-allocation';
import { InvoiceMonthlyTrend } from '@/app/components/aws-invoices/invoice-monthly-trend';
import { InvoiceServicesTable } from '@/app/components/aws-invoices/invoice-services-table';
import { InvoiceHistory } from '@/app/components/aws-invoices/invoice-history';
import { AwsInvoiceUpload } from '@/app/components/aws-invoices/aws-invoice-upload';

const { mockUseAwsInvoiceUpload } = vi.hoisted(() => ({
  mockUseAwsInvoiceUpload: vi.fn(),
}));

vi.mock('@/frontend/hooks/use-aws-invoice-upload', () => ({
  useAwsInvoiceUpload: () => mockUseAwsInvoiceUpload(),
}));

vi.mock('recharts', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Empty = () => null;
  return {
    ResponsiveContainer: Wrapper,
    PieChart: Wrapper,
    Pie: Wrapper,
    Cell: Empty,
    Tooltip: Empty,
    Legend: Empty,
    BarChart: Wrapper,
    Bar: Wrapper,
    XAxis: Empty,
    YAxis: Empty,
    CartesianGrid: Empty,
    LineChart: Wrapper,
    Line: Empty,
  };
});

afterEach(() => cleanup());

const selected = {
  seller: 'Amazon Web Services, Inc.' as const,
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD' as const,
  totals: { charges: 120, credits: 5, tax: 12, amountDue: 127 },
  services: [
    { name: 'Compute', charges: 70, tax: 7, total: 77 },
    { name: 'Storage', charges: 50, tax: 5, total: 55 },
  ],
  linkedAccounts: [
    {
      accountLast4: '1234',
      charges: 120,
      credits: 5,
      tax: 12,
      total: 127,
      services: [
        { name: 'Compute', charges: 70, tax: 7, total: 77 },
        { name: 'Storage', charges: 50, tax: 5, total: 55 },
      ],
    },
  ],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: 'a'.repeat(64),
    uploadedAt: '2026-08-03T12:00:00.000Z',
  },
};

const dashboard: AwsInvoiceDashboard = {
  selected,
  yearMonth: '2026-07',
  kpis: {
    amountDue: 127,
    serviceCharges: 120,
    credits: 5,
    tax: 12,
    linkedAccountCount: 1,
    billedServiceCount: 2,
  },
  serviceBreakdown: [
    { name: 'Storage', value: 55, percentage: 41.67 },
    { name: 'Compute', value: 77, percentage: 58.33 },
  ],
  topServices: [
    { name: 'Storage', value: 55, percentage: 41.67 },
    { name: 'Compute', value: 77, percentage: 58.33 },
  ],
  chargeComposition: [
    { name: 'Charges', value: 120 },
    { name: 'Credits', value: 5 },
    { name: 'Tax', value: 12 },
  ],
  accountAllocations: [
    { accountLast4: '1234', value: 127, percentage: 100 },
  ],
  monthlyTrend: [
    { yearMonth: '2026-06', value: 100 },
    { yearMonth: '2026-07', value: 127 },
  ],
  serviceDetails: selected.services,
};

describe('AWS invoice KPI and charts', () => {
  it('renders the six exact KPI values', () => {
    render(<InvoiceKpiCards dashboard={dashboard} />);
    for (const label of [
      'Amount due',
      'Service charges',
      'Credits',
      'Tax',
      'Linked accounts',
      'Billed services',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('$127.00')).toBeTruthy();
    expect(screen.getByText('$120.00')).toBeTruthy();
    expect(screen.getByText('$5.00')).toBeTruthy();
    expect(screen.getByText('$12.00')).toBeTruthy();
  });

  it('exposes exact chart summaries and masked account labels', () => {
    render(
      <>
        <InvoiceServicePie dashboard={dashboard} />
        <InvoiceTopServices dashboard={dashboard} />
        <InvoiceTaxComposition dashboard={dashboard} />
        <InvoiceAccountAllocation dashboard={dashboard} />
        <InvoiceMonthlyTrend dashboard={dashboard} />
      </>,
    );

    expect(
      screen.getByRole('img', { name: /service breakdown/i }),
    ).toHaveTextContent('Compute: $77.00');
    expect(
      screen.getByRole('img', { name: /top services/i }),
    ).toHaveTextContent('Compute: $77.00');
    expect(
      screen.getByRole('img', { name: /charge and tax composition/i }),
    ).toHaveTextContent('Credits: $5.00');
    expect(
      screen.getByRole('img', { name: /linked account allocation/i }),
    ).toHaveTextContent('•••• 1234: $127.00');
    expect(
      screen.getByRole('img', { name: /monthly invoice trend/i }),
    ).toHaveTextContent('2026-06: $100.00');

    const topText = screen.getByRole('img', { name: /top services/i }).textContent;
    expect(topText?.indexOf('Compute')).toBeLessThan(topText?.indexOf('Storage') ?? 0);
    expect(document.body.textContent).not.toMatch(/123456789012|invoiceNumber|billTo/i);
    expect(
      Array.from(document.querySelectorAll('[aria-label]'))
        .map((node) => node.getAttribute('aria-label'))
        .join(' '),
    ).not.toMatch(/123456789012|invoiceNumber|billTo/i);
  });

  it('renders explicit empty chart states', () => {
    const empty = {
      ...dashboard,
      serviceBreakdown: [],
      topServices: [],
      accountAllocations: [],
      monthlyTrend: [],
    };
    render(
      <>
        <InvoiceServicePie dashboard={empty} />
        <InvoiceTopServices dashboard={empty} />
        <InvoiceAccountAllocation dashboard={empty} />
        <InvoiceMonthlyTrend dashboard={empty} />
      </>,
    );
    expect(screen.getAllByText(/No .* data/i)).toHaveLength(4);
  });
});

describe('AWS invoice tables', () => {
  it('sorts services deterministically and paginates detail rows', () => {
    const services = Array.from({ length: 12 }, (_, index) => ({
      name: `Service ${String(index + 1).padStart(2, '0')}`,
      charges: index + 1,
      tax: 1,
      total: index + 2,
    }));
    render(<InvoiceServicesTable services={services} currency="USD" />);

    const body = screen.getByTestId('invoice-services-body');
    expect(within(body).getAllByRole('row')).toHaveLength(10);
    expect(within(body).getAllByRole('row')[0]).toHaveTextContent('Service 12');
    fireEvent.click(screen.getByRole('button', { name: /sort by service/i }));
    expect(within(body).getAllByRole('row')[0]).toHaveTextContent('Service 01');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  });

  it('shows only privacy-safe history fields with view and delete actions', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <InvoiceHistory
        items={[
          {
            yearMonth: '2026-07',
            currency: 'USD',
            amountDue: 127,
            tax: 12,
            serviceCount: 2,
            linkedAccountCount: 1,
            uploadedAt: '2026-08-03T12:00:00.000Z',
          },
        ]}
        selectedYearMonth="2026-07"
        onSelect={onSelect}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText('July 2026')).toBeTruthy();
    expect(screen.getByText('$127.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /view July 2026/i }));
    expect(onSelect).toHaveBeenCalledWith('2026-07');
    fireEvent.click(screen.getByRole('button', { name: /delete July 2026/i }));
    expect(screen.getByText('Delete July 2026 invoice?')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/accountId|invoiceNumber|billTo/i);
  });
});

describe('AWS invoice upload', () => {
  it('renders a PDF-only 5 MiB dropzone and current progress label', () => {
    mockUseAwsInvoiceUpload.mockReturnValue({
      state: { phase: 'working', step: 'polling', message: 'Processing invoice…' },
      start: vi.fn(),
      reset: vi.fn(),
    });
    render(<AwsInvoiceUpload />);

    expect(screen.getByRole('status')).toHaveTextContent('Processing invoice…');
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'application/pdf,.pdf');
  });

  it('confirms month replacement before force upload', () => {
    const file = new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' });
    const start = vi.fn();
    mockUseAwsInvoiceUpload.mockReturnValue({
      state: {
        phase: 'conflict',
        conflict: { year: 2026, month: 7 },
        file,
      },
      start,
      reset: vi.fn(),
    });
    render(<AwsInvoiceUpload />);

    expect(screen.getByText('Replace existing invoice?')).toBeTruthy();
    expect(screen.getByText(/July 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replace invoice' }));
    expect(start).toHaveBeenCalledWith(file, true);
  });
});
