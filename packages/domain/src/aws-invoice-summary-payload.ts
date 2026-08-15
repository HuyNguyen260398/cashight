import {
  AwsInvoiceSummaryPayloadSchema,
  YearMonthSchema,
  type AwsInvoice,
  type AwsInvoiceMetadata,
  type AwsInvoiceSummaryPayload,
} from './aws-invoices';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : round2((value / total) * 100);
}

function compareLabel(left: string, right: string): number {
  return left
    .toLocaleLowerCase('en-US')
    .localeCompare(right.toLocaleLowerCase('en-US'), 'en-US');
}

export function buildAwsInvoiceSummaryPayload(
  invoice: AwsInvoice,
  history: AwsInvoiceMetadata[],
): AwsInvoiceSummaryPayload {
  const yearMonth = YearMonthSchema.parse(invoice.billingPeriod.start.slice(0, 7));
  const previous = [...history]
    .filter((item) => item.yearMonth < yearMonth)
    .sort((left, right) => right.yearMonth.localeCompare(left.yearMonth))[0];
  const serviceTotal = invoice.services.reduce(
    (total, service) => total + service.total,
    0,
  );
  const accountTotal = invoice.linkedAccounts.reduce(
    (total, account) => total + account.total,
    0,
  );
  const monthOverMonth = previous
    ? {
        amount: round2(invoice.totals.amountDue - previous.amountDue),
        percentage:
          previous.amountDue === 0
            ? 0
            : round2(
                ((invoice.totals.amountDue - previous.amountDue) /
                  previous.amountDue) *
                  100,
              ),
      }
    : undefined;

  return AwsInvoiceSummaryPayloadSchema.parse({
    yearMonth,
    currency: invoice.currency,
    totals: {
      charges: invoice.totals.charges,
      credits: invoice.totals.credits,
      tax: invoice.totals.tax,
      amountDue: invoice.totals.amountDue,
    },
    ...(monthOverMonth ? { monthOverMonth } : {}),
    topServices: [...invoice.services]
      .sort(
        (left, right) =>
          right.total - left.total || compareLabel(left.name, right.name),
      )
      .slice(0, 5)
      .map((service) => ({
        name: service.name,
        amount: service.total,
        percentage: percentage(service.total, serviceTotal),
      })),
    accountAllocations: [...invoice.linkedAccounts]
      .sort((left, right) => right.total - left.total)
      .map((account) => ({
        percentage: percentage(account.total, accountTotal),
      })),
    taxRatio: percentage(invoice.totals.tax, invoice.totals.amountDue),
  });
}
