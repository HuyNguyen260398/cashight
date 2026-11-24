'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { YearMonthSchema, type YearMonth } from '@cashight/domain/aws-invoices';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { AWS_INVOICES_CHANGED_EVENT } from '@/frontend/hooks/use-aws-invoice-upload';
import { useAwsInvoices } from '@/frontend/hooks/use-aws-invoices';
import { AwsInvoiceUpload } from './aws-invoice-upload';
import { AwsInvoiceAiSummary } from './aws-invoice-ai-summary';
import { InvoiceCostUsageGraph } from './invoice-cost-usage-graph';
import { formatInvoiceMonth } from './invoice-format';
import { InvoiceHistory } from './invoice-history';
import { InvoiceKpiCards } from './invoice-kpi-cards';
import { InvoiceMonthlyTrend } from './invoice-monthly-trend';
import { InvoiceServicesTable } from './invoice-services-table';
import { AlertHeading } from '@/app/components/console/alert-heading';

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
    <Container>
      <div aria-label="Loading AWS invoice dashboard" aria-busy="true">
        <StatusIndicator type="loading">Loading AWS invoice dashboard…</StatusIndicator>
      </div>
    </Container>
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

  // An upload names its own month — the parser reads it off the invoice — and
  // that is rarely the month on screen, since the invoice for a period arrives
  // in the next one. Every panel here needs an invoice for the selected month,
  // so without this the page sits on its empty state after a successful upload
  // while history shows the record that was just created.
  useEffect(() => {
    function handleChanged(event: Event) {
      const uploaded = (event as CustomEvent<{ yearMonth?: YearMonth }>).detail
        ?.yearMonth;
      if (!uploaded || uploaded === requestedMonth) return;
      router.push(invoiceMonthHref(uploaded));
    }
    window.addEventListener(AWS_INVOICES_CHANGED_EVENT, handleChanged);
    return () =>
      window.removeEventListener(AWS_INVOICES_CHANGED_EVENT, handleChanged);
  }, [requestedMonth, router]);

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
    <main>
      <ContentLayout
        header={
          <Header
            variant="h1"
            description="Review reconciled monthly charges without exposing invoice or account identifiers."
            actions={
              <SpaceBetween direction="horizontal" size="xxs" alignItems="center">
                <Button
                  variant="icon"
                  iconName="angle-left"
                  ariaLabel="Previous invoice month"
                  onClick={() => navigate(shiftInvoiceMonth(displayMonth, -1))}
                />
                <Box fontWeight="bold">
                  <span style={{ display: 'inline-block', minWidth: 128, textAlign: 'center' }}>
                    {formatInvoiceMonth(displayMonth)}
                  </span>
                </Box>
                <Button
                  variant="icon"
                  iconName="angle-right"
                  ariaLabel="Next invoice month"
                  onClick={() => navigate(shiftInvoiceMonth(displayMonth, 1))}
                />
              </SpaceBetween>
            }
          >
            Billing invoices
          </Header>
        }
      >
        <SpaceBetween size="l">
          <AwsInvoiceUpload />

          {error && dashboard ? (
            <div role="alert">
              <Alert type="warning">The last loaded invoice remains visible. Refresh failed: {error}</Alert>
            </div>
          ) : null}
          {loading && dashboard ? (
            <p className="visually-hidden" role="status">
              Refreshing AWS invoice dashboard…
            </p>
          ) : null}

          {!requestedMonth || (loading && !dashboard) ? (
            <InvoiceDashboardSkeleton />
          ) : error && !dashboard ? (
            <div role="alert">
              <Alert type="error" header={<AlertHeading>Couldn&apos;t load AWS invoices</AlertHeading>}>
                {error}
              </Alert>
            </div>
          ) : !invoice || !dashboard ? (
            <Container>
              <Box textAlign="center" padding={{ vertical: 'xl' }}>
                <SpaceBetween size="xs">
                  <Box variant="h2">No invoice for {formatInvoiceMonth(requestedMonth)}</Box>
                  <Box color="text-body-secondary">
                    Upload the supported AWS consolidated invoice, or choose another month from history.
                  </Box>
                </SpaceBetween>
              </Box>
            </Container>
          ) : (
            <SpaceBetween size="l">
              <div data-dashboard-panel="kpis"><InvoiceKpiCards dashboard={dashboard} /></div>
              <div data-dashboard-panel="ai"><AwsInvoiceAiSummary yearMonth={requestedMonth} /></div>
              <div data-dashboard-panel="trend"><InvoiceMonthlyTrend dashboard={dashboard} /></div>
              <div data-dashboard-panel="cost-usage"><InvoiceCostUsageGraph yearMonth={requestedMonth} /></div>
              <div data-dashboard-panel="table">
                <InvoiceServicesTable services={dashboard.serviceDetails} currency={dashboard.selected.currency} />
              </div>
            </SpaceBetween>
          )}

          {requestedMonth ? (
            <div data-dashboard-panel="history">
              <InvoiceHistory items={history} selectedYearMonth={requestedMonth} onSelect={navigate} onDelete={deleteAndNavigate} />
            </div>
          ) : null}
          {deleting ? <p className="visually-hidden" role="status">Deleting invoice…</p> : null}
        </SpaceBetween>
      </ContentLayout>
    </main>
  );
}
