'use client';

import { Suspense } from 'react';

import { AwsInvoiceDashboard } from '@/app/components/aws-invoices/aws-invoice-dashboard';
import { ProtectedRoute } from '@/frontend/auth/protected-route';

function InvoicePageLoading() {
  return (
    <main className="surface-card min-h-80 animate-pulse p-6 motion-reduce:animate-none" aria-label="Loading AWS invoice page" aria-busy="true">
      <div className="h-6 w-48 rounded bg-gray-100 dark:bg-gray-800" />
      <div className="mt-6 h-52 rounded-xl bg-gray-100 dark:bg-gray-800" />
    </main>
  );
}

export default function AwsBillingInvoicePage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<InvoicePageLoading />}>
        <AwsInvoiceDashboard />
      </Suspense>
    </ProtectedRoute>
  );
}
