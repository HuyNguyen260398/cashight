'use client';

import { useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getOidcManager } from '@/frontend/auth/oidc';

export const COST_EXPLORER_RETURN_TO = '/aws/cost-explorer/' as const;

export function CognitoReauthWarning() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueWithCognito = async () => {
    setLoading(true);
    setError(null);
    try {
      await getOidcManager().signinRedirect({
        state: { returnTo: COST_EXPLORER_RETURN_TO },
      });
    } catch (cause) {
      setLoading(false);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not start Cognito sign-in. Please try again.',
      );
    }
  };

  return (
    <div
      role="alert"
      className="rounded-2xl border border-warning-200 bg-warning-50 p-5 shadow-theme-xs dark:border-warning-500/30 dark:bg-warning-500/10"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">
            <ShieldAlert className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white/90">
              Continue with Cognito to view AWS costs
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              Your current Google-federated session can still use Cashight, but AWS billing data requires a native Cognito session. Cashight never asks for AWS credentials in the browser.
            </p>
            {error ? (
              <p className="mt-2 text-sm text-error-700 dark:text-error-400">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          className="min-h-11 shrink-0"
          disabled={loading}
          onClick={() => void continueWithCognito()}
        >
          {loading ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : null}
          {loading ? 'Opening Cognito…' : 'Continue with Cognito'}
        </Button>
      </div>
    </div>
  );
}
