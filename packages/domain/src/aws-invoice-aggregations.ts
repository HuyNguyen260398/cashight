import {
  AwsInvoiceDashboardSchema,
  type AwsInvoice,
  type AwsInvoiceDashboard,
  type AwsInvoiceMetadata,
  type AwsInvoiceService,
} from './aws-invoices';

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 10_000) / 100;
}

function compareLabel(left: string, right: string): number {
  return left.toLocaleLowerCase('en-US').localeCompare(
    right.toLocaleLowerCase('en-US'),
    'en-US',
  );
}

function compareService(left: AwsInvoiceService, right: AwsInvoiceService): number {
  return right.total - left.total || compareLabel(left.name, right.name);
}

export function aggregateAwsInvoiceDashboard(
  selected: AwsInvoice,
  history: AwsInvoiceMetadata[],
): AwsInvoiceDashboard {
  const yearMonth = selected.billingPeriod.start.slice(0, 7);
  const serviceDetails = [...selected.services].sort(compareService);
  const serviceTotal = serviceDetails.reduce(
    (total, service) => total + service.total,
    0,
  );
  const serviceBreakdown = serviceDetails.map((service) => ({
    name: service.name,
    value: service.total,
    percentage: percentage(service.total, serviceTotal),
  }));
  const accountTotal = selected.linkedAccounts.reduce(
    (total, account) => total + account.total,
    0,
  );
  const accountAllocations = [...selected.linkedAccounts]
    .sort(
      (left, right) =>
        right.total - left.total || left.accountLast4.localeCompare(right.accountLast4),
    )
    .map((account) => ({
      accountLast4: account.accountLast4,
      value: account.total,
      percentage: percentage(account.total, accountTotal),
    }));
  const trendByMonth = new Map(
    history.map((item) => [item.yearMonth, roundCurrency(item.amountDue)]),
  );
  trendByMonth.set(yearMonth, roundCurrency(selected.totals.amountDue));
  const monthlyTrend = [...trendByMonth]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, value]) => ({ yearMonth: month, value }));

  return AwsInvoiceDashboardSchema.parse({
    selected,
    yearMonth,
    kpis: {
      amountDue: selected.totals.amountDue,
      serviceCharges: selected.totals.charges,
      credits: selected.totals.credits,
      tax: selected.totals.tax,
      linkedAccountCount: selected.linkedAccounts.length,
      billedServiceCount: selected.services.length,
    },
    serviceBreakdown,
    topServices: serviceBreakdown.slice(0, 10),
    chargeComposition: [
      { name: 'Charges', value: selected.totals.charges },
      { name: 'Credits', value: selected.totals.credits },
      { name: 'Tax', value: selected.totals.tax },
    ],
    accountAllocations,
    monthlyTrend,
    serviceDetails,
  });
}
