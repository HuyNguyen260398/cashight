'use client';

import { useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
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
    <div role="alert">
      <Alert
        type="warning"
        header={
          <span role="heading" aria-level={2}>
            Continue with Cognito to view AWS costs
          </span>
        }
        action={
          <Button loading={loading} onClick={() => void continueWithCognito()}>
            {loading ? 'Opening Cognito…' : 'Continue with Cognito'}
          </Button>
        }
      >
        Your current Google-federated session can still use Cashight, but AWS billing data requires a native Cognito
        session. Cashight never asks for AWS credentials in the browser.
        {error ? <div>{error}</div> : null}
      </Alert>
    </div>
  );
}
