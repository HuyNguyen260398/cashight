'use client';

import { Suspense } from 'react';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { CostExplorerDashboard } from '@/app/components/aws-cost-explorer/cost-explorer-dashboard';
import { ProtectedRoute } from '@/frontend/auth/protected-route';
import { isAwsCostExplorerEnabled } from '@/frontend/config/features';

function CostExplorerPageLoading() {
  return (
    <div aria-label="Loading AWS Cost Explorer" aria-busy="true">
      <Container>
        <StatusIndicator type="loading">Loading AWS Cost Explorer…</StatusIndicator>
      </Container>
    </div>
  );
}

function CostExplorerUnavailable() {
  return (
    <div>
      <ContentLayout header={<Header variant="h1">AWS Cost Explorer is not enabled</Header>}>
        <Container>
          This production feature remains disabled until its AWS access, cache, alarms, and smoke checks have been
          verified by an operator.
        </Container>
      </ContentLayout>
    </div>
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
