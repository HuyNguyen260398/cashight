'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/frontend/auth/protected-route';
import { legacyStatementHref } from '@/frontend/lib/dashboard-routes';

type Props = { section: 'statement-upload' | 'statement-history' };

function RedirectInner({ section }: Props) {
  const search = useSearchParams().toString();
  const router = useRouter();
  useEffect(() => {
    router.replace(legacyStatementHref(new URLSearchParams(search), section));
  }, [router, search, section]);
  return null;
}

export function LegacyStatementRedirect(props: Props) {
  return <ProtectedRoute><Suspense><RedirectInner {...props} /></Suspense></ProtectedRoute>;
}
