'use client';

import { useEffect, useRef } from 'react';
import { getOidcManager } from '@/frontend/auth/oidc';
import { resolveOidcCallbackReturn } from '@/frontend/auth/return-to';

/**
 * Landing page for the Cognito PKCE redirect. Calls
 * `signinRedirectCallback()` to exchange the authorization code for tokens,
 * then sends the user to the dashboard. On failure, redirects to the sign-in
 * page with an error indicator.
 */
export default function AuthCallbackPage() {
  const hasRun = useRef(false);

  useEffect(() => {
    // The authorization code + PKCE state are single-use — StrictMode's dev-only
    // double-invoke would otherwise consume them twice and fail the second call
    // with "No matching state found in storage".
    if (hasRun.current) return;
    hasRun.current = true;

    async function handleCallback() {
      try {
        const manager = getOidcManager();
        const user = await manager.signinRedirectCallback();
        // Full navigation (not router.replace): AuthProvider only restores the
        // session on mount, and it's mounted once at the root layout, so a
        // client-side route change would leave it holding a stale
        // unauthenticated state and ProtectedRoute would bounce back to /signin.
        window.location.href = resolveOidcCallbackReturn(user?.state);
      } catch (err) {
        console.error('Auth callback failed:', err);
        window.location.href = '/signin/?error=callback';
      }
    }

    void handleCallback();
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <p className="text-gray-500 dark:text-gray-400">Completing sign-in…</p>
    </main>
  );
}
