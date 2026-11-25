'use client';

import { Suspense } from 'react';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { AwsInvoiceDashboard } from '@/app/components/aws-invoices/aws-invoice-dashboard';
import { ProtectedRoute } from '@/frontend/auth/protected-route';
import { isAwsBillingInvoiceEnabled } from '@/frontend/config/features';

function InvoicePageLoading() {
  return (
    <div aria-label="Loading AWS invoice page" aria-busy="true">
      <Container>
        <StatusIndicator type="loading">Loading AWS invoice page…</StatusIndicator>
      </Container>
    </div>
  );
}

function InvoicePageUnavailable() {
  return (
    <div>
      <ContentLayout header={<Header variant="h1">AWS billing invoices are not enabled</Header>}>
        <Container>
          This feature remains disabled until its parser, privacy scan, queues, alarms, and smoke checks have been
          verified by an operator.
        </Container>
      </ContentLayout>
    </div>
  );
}

export default function AwsBillingInvoicePage() {
  return (
    <ProtectedRoute>
      {isAwsBillingInvoiceEnabled() ? (
        <Suspense fallback={<InvoicePageLoading />}>
          <AwsInvoiceDashboard />
        </Suspense>
      ) : (
        <InvoicePageUnavailable />
      )}
    </ProtectedRoute>
  );
}
