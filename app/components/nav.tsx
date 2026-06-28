'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/frontend/auth/auth-provider';
import { getOidcManager } from '@/frontend/auth/oidc';
import { AdminShell } from './admin-shell';

/**
 * Top-level navigation shell. Sources the user's email from the OIDC
 * AuthProvider instead of Auth.js. When no session is present it renders
 * children directly (sign-in and public pages pass through unchanged).
 */
export function Nav({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const email = (user?.profile as { email?: string } | undefined)?.email ?? '';

  async function signOutAction() {
    const manager = getOidcManager();
    await manager.signoutRedirect();
  }

  // While the session is being restored from sessionStorage, show the page
  // without the shell to avoid a flash of unauthenticated chrome.
  if (loading) return <>{children}</>;
  if (!email) return <>{children}</>;

  return (
    <AdminShell email={email} signOutAction={signOutAction}>
      {children}
    </AdminShell>
  );
}
