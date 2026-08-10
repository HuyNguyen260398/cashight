'use client';

import { Suspense } from 'react';

import { CostExplorerDashboard } from '@/app/components/aws-cost-explorer/cost-explorer-dashboard';
import { ProtectedRoute } from '@/frontend/auth/protected-route';

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

export default function CostExplorerPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<CostExplorerPageLoading />}>
        <CostExplorerDashboard />
      </Suspense>
    </ProtectedRoute>
  );
}
