'use client';

import { Suspense } from 'react';

import { CostExplorerDashboard } from '@/app/components/aws-cost-explorer/cost-explorer-dashboard';
import { ProtectedRoute } from '@/frontend/auth/protected-route';
import { isAwsCostExplorerEnabled } from '@/frontend/config/features';

function CostExplorerPageLoading() {
  return (
    <main
      className="surface-card min-h-80 animate-pulse p-6 motion-reduce:animate-none"
      aria-label="Loading AWS Cost Explorer"
      aria-busy="true"
    >
      <div className="h-6 w-48 rounded bg-gray-100 dark:bg-gray-800" />
      <div className="mt-6 h-52 rounded-xl bg-gray-100 dark:bg-gray-800" />
    </main>
  );
}

function CostExplorerUnavailable() {
  return (
    <main className="surface-card p-6">
      <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
        AWS billing analytics
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
        AWS Cost Explorer is not enabled
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
        This production feature remains disabled until its AWS access, cache,
        alarms, and smoke checks have been verified by an operator.
      </p>
    </main>
  );
}

export default function CostExplorerPage() {
  return (
    <ProtectedRoute>
      {isAwsCostExplorerEnabled() ? (
        <Suspense fallback={<CostExplorerPageLoading />}>
          <CostExplorerDashboard />
        </Suspense>
      ) : (
        <CostExplorerUnavailable />
      )}
    </ProtectedRoute>
  );
}
