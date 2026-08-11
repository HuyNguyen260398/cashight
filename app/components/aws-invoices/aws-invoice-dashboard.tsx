'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { YearMonthSchema, type YearMonth } from '@cashight/domain/aws-invoices';
import { ChevronLeft, ChevronRight, Cloud, FileQuestion } from 'lucide-react';

import { RevealPanel } from '@/app/components/reveal-panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAwsInvoices } from '@/frontend/hooks/use-aws-invoices';
import { AwsInvoiceUpload } from './aws-invoice-upload';
import { AwsInvoiceAiSummary } from './aws-invoice-ai-summary';
import { InvoiceAccountAllocation } from './invoice-account-allocation';
import { formatInvoiceMonth } from './invoice-format';
import { InvoiceHistory } from './invoice-history';
import { InvoiceKpiCards } from './invoice-kpi-cards';
import { InvoiceMonthlyTrend } from './invoice-monthly-trend';
import { InvoiceServicePie } from './invoice-service-pie';
import { InvoiceServicesTable } from './invoice-services-table';
import { InvoiceTaxComposition } from './invoice-tax-composition';
import { InvoiceTopServices } from './invoice-top-services';

export function parseInvoiceYearMonth(search: URLSearchParams): YearMonth | null {
  const year = search.get('year');
  const month = search.get('month');
  if (!year || !month || !/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month)) {
    return null;
  }
  const parsed = YearMonthSchema.safeParse(`${year}-${month.padStart(2, '0')}`);
  return parsed.success ? parsed.data : null;
}

export function shiftInvoiceMonth(yearMonth: YearMonth, delta: number): YearMonth {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return YearMonthSchema.parse(
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
  );
}

function currentYearMonth(): YearMonth {
  const now = new Date();
  return YearMonthSchema.parse(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
}

function invoiceMonthHref(yearMonth: YearMonth): string {
  const [year, month] = yearMonth.split('-');
  return `/aws/billing-invoice/?year=${year}&month=${Number(month)}`;
}

function InvoiceDashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading AWS invoice dashboard" aria-busy="true">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-2xl motion-reduce:animate-none" />)}
      </div>
      <Skeleton className="h-80 rounded-2xl motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2"><Skeleton className="h-80 rounded-2xl motion-reduce:animate-none" /><Skeleton className="h-80 rounded-2xl motion-reduce:animate-none" /></div>
    </div>
  );
}

export function AwsInvoiceDashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedMonth = parseInvoiceYearMonth(searchParams);
  const { invoice, dashboard, history, loading, deleting, error, deleteInvoice } = useAwsInvoices(requestedMonth);

  useEffect(() => {
    if (requestedMonth || loading) return;
    const fallback = history[0]?.yearMonth ?? currentYearMonth();
    router.replace(invoiceMonthHref(fallback));
  }, [history, loading, requestedMonth, router]);

  function navigate(yearMonth: YearMonth) {
    router.push(invoiceMonthHref(yearMonth));
  }

  async function deleteAndNavigate(target: YearMonth) {
    await deleteInvoice(target);
    if (target !== requestedMonth) return;
    const fallback = history.find((item) => item.yearMonth !== target)?.yearMonth ?? currentYearMonth();
    navigate(fallback);
  }

  const displayMonth = requestedMonth ?? history[0]?.yearMonth ?? currentYearMonth();

  return (
    <main className="space-y-6">
      <header className="surface-card flex flex-col gap-4 p-5 md:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><Cloud className="size-5" aria-hidden /></span>
          <div><p className="text-sm font-medium text-brand-500 dark:text-brand-400">AWS billing analytics</p><h1 className="mt-0.5 text-2xl font-semibold text-gray-900 dark:text-white/90">Billing invoices</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Review reconciled monthly charges without exposing invoice or account identifiers.</p></div>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-white/[0.03]">
          <Button variant="ghost" size="icon" className="size-11" aria-label="Previous invoice month" onClick={() => navigate(shiftInvoiceMonth(displayMonth, -1))}><ChevronLeft aria-hidden /></Button>
          <span className="min-w-32 text-center text-sm font-semibold text-gray-800 dark:text-gray-200">{formatInvoiceMonth(displayMonth)}</span>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Next invoice month" onClick={() => navigate(shiftInvoiceMonth(displayMonth, 1))}><ChevronRight aria-hidden /></Button>
        </div>
      </header>

      <AwsInvoiceUpload />

      {error && dashboard ? (
        <div role="alert" className="rounded-2xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
          The last loaded invoice remains visible. Refresh failed: {error}
        </div>
      ) : null}
      {loading && dashboard ? <p className="sr-only" role="status">Refreshing AWS invoice dashboard…</p> : null}

      {!requestedMonth || (loading && !dashboard) ? (
        <InvoiceDashboardSkeleton />
      ) : error && !dashboard ? (
        <div role="alert" className="rounded-2xl border border-error-200 bg-error-50 p-5 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400"><h2 className="font-semibold text-gray-900 dark:text-white/90">Couldn&apos;t load AWS invoices</h2><p className="mt-1">{error}</p></div>
      ) : !invoice || !dashboard ? (
        <section className="surface-card px-6 py-14 text-center"><span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300"><FileQuestion className="size-7" aria-hidden /></span><h2 className="mt-5 text-xl font-semibold text-gray-900 dark:text-white/90">No invoice for {formatInvoiceMonth(requestedMonth)}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">Upload the supported AWS consolidated invoice, or choose another month from history.</p></section>
      ) : (
        <div className="grid grid-cols-12 gap-4 md:gap-6">
          <RevealPanel delayIndex={0} className="col-span-12"><div data-dashboard-panel="kpis"><InvoiceKpiCards dashboard={dashboard} /></div></RevealPanel>
          <RevealPanel delayIndex={1} className="col-span-12"><div data-dashboard-panel="ai"><AwsInvoiceAiSummary yearMonth={requestedMonth} /></div></RevealPanel>
          <RevealPanel delayIndex={2} className="col-span-12"><div data-dashboard-panel="trend"><InvoiceMonthlyTrend dashboard={dashboard} /></div></RevealPanel>
          <RevealPanel delayIndex={3} className="col-span-12 xl:col-span-6"><div data-dashboard-panel="services"><InvoiceServicePie dashboard={dashboard} /></div></RevealPanel>
          <RevealPanel delayIndex={4} className="col-span-12 xl:col-span-6"><div data-dashboard-panel="top-services"><InvoiceTopServices dashboard={dashboard} /></div></RevealPanel>
          <RevealPanel delayIndex={5} className="col-span-12 xl:col-span-6"><div data-dashboard-panel="accounts"><InvoiceAccountAllocation dashboard={dashboard} /></div></RevealPanel>
          <RevealPanel delayIndex={6} className="col-span-12 xl:col-span-6"><div data-dashboard-panel="tax"><InvoiceTaxComposition dashboard={dashboard} /></div></RevealPanel>
          <RevealPanel delayIndex={7} className="col-span-12"><div data-dashboard-panel="table"><InvoiceServicesTable services={dashboard.serviceDetails} currency={dashboard.selected.currency} /></div></RevealPanel>
        </div>
      )}

      {requestedMonth ? <div data-dashboard-panel="history"><InvoiceHistory items={history} selectedYearMonth={requestedMonth} onSelect={navigate} onDelete={deleteAndNavigate} /></div> : null}
      {deleting ? <p className="sr-only" role="status">Deleting invoice…</p> : null}
    </main>
  );
}
