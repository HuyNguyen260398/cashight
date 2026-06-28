'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getOidcManager } from '@/frontend/auth/oidc';

/**
 * Landing page for the Cognito PKCE redirect. Calls
 * `signinRedirectCallback()` to exchange the authorization code for tokens,
 * then sends the user to the dashboard. On failure, redirects to the sign-in
 * page with an error indicator.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    async function handleCallback() {
      try {
        const manager = getOidcManager();
        await manager.signinRedirectCallback();
        router.replace('/');
      } catch (err) {
        console.error('Auth callback failed:', err);
        router.replace('/signin?error=callback');
      }
    }

    void handleCallback();
  }, [router]);

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <p className="text-gray-500 dark:text-gray-400">Completing sign-in…</p>
    </main>
  );
}
