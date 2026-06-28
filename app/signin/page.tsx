'use client';

import { Button } from '@/components/ui/button';
import { BarChart3, ShieldCheck } from 'lucide-react';
import { getOidcManager } from '@/frontend/auth/oidc';

export default function SignInPage() {
  // Read the ?error= query parameter on the client side.
  const error =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('error')
      : null;

  function handleGoogle() {
    const manager = getOidcManager();
    void manager.signinRedirect({
      extraQueryParams: { identity_provider: 'Google' },
    });
  }

  function handleCognito() {
    const manager = getOidcManager();
    void manager.signinRedirect();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-theme-lg dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-theme-xs">
          <BarChart3 className="size-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white/90">
          Cashight
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Sign in to track your spending.
        </p>
        <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-700 dark:bg-success-500/10 dark:text-success-500">
          <ShieldCheck className="size-3.5" aria-hidden />
          Private single-user workspace
        </div>
        {error ? (
          <p className="mt-4 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-500">
            {error === 'AccessDenied'
              ? "That account isn't allowed to access this app."
              : "Couldn't sign you in. Please try again."}
          </p>
        ) : null}
        <div className="mt-6">
          <Button type="button" className="w-full" onClick={handleGoogle}>
            Sign in with Google
          </Button>
        </div>
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleCognito}
          >
            Sign in with Cognito
          </Button>
        </div>
      </div>
    </main>
  );
}
