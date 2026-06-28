'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';

/**
 * Renders `children` only when the user is authenticated.
 * While loading, renders nothing. When the session is absent after loading
 * completes, replaces the current route with /signin.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/signin');
    }
  }, [user, loading, router]);

  if (loading) return null;
  if (!user) return null;

  return <>{children}</>;
}
