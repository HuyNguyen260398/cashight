'use client';

import { Suspense } from 'react';

import { AwsInvoiceDashboard } from '@/app/components/aws-invoices/aws-invoice-dashboard';
import { ProtectedRoute } from '@/frontend/auth/protected-route';
import { isAwsBillingInvoiceEnabled } from '@/frontend/config/features';

function InvoicePageLoading() {
  return (
    <main className="surface-card min-h-80 animate-pulse p-6 motion-reduce:animate-none" aria-label="Loading AWS invoice page" aria-busy="true">
      <div className="h-6 w-48 rounded bg-gray-100 dark:bg-gray-800" />
      <div className="mt-6 h-52 rounded-xl bg-gray-100 dark:bg-gray-800" />
    </main>
  );
}

function InvoicePageUnavailable() {
  return (
    <main className="surface-card p-6">
      <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
        AWS billing analytics
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
        AWS billing invoices are not enabled
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
        This feature remains disabled until its parser, privacy scan, queues,
        alarms, and smoke checks have been verified by an operator.
      </p>
    </main>
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
