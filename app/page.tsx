'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/frontend/auth/protected-route';
import { DEFAULT_DASHBOARD_HREF, hasBankDashboardContext } from '@/frontend/lib/dashboard-routes';
import { BankStatementDashboard } from './components/bank-statement-dashboard';

function HomeInner() {
  const search = useSearchParams();
  const router = useRouter();
  const isBankView = hasBankDashboardContext(search);
  useEffect(() => {
    if (!isBankView) router.replace(DEFAULT_DASHBOARD_HREF);
  }, [isBankView, router]);
  return isBankView ? <BankStatementDashboard /> : null;
}

export default function HomePage() {
  return (
    <ProtectedRoute>
      <Suspense>
        <HomeInner />
      </Suspense>
    </ProtectedRoute>
  );
}
