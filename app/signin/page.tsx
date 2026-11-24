'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { getOidcManager } from '@/frontend/auth/oidc';
import { allowlistedOidcReturnTo } from '@/frontend/auth/return-to';

/** Reads ?error= from the URL and renders the error banner when present. */
function SignInError() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  if (!error) return null;
  return (
    <Alert type="error">
      {error === 'AccessDenied'
        ? "That account isn't allowed to access this app."
        : "Couldn't sign you in. Please try again."}
    </Alert>
  );
}

function SignInActions() {
  const searchParams = useSearchParams();
  const returnTo = allowlistedOidcReturnTo(searchParams.get('returnTo'));

  function handleGoogle() {
    const manager = getOidcManager();
    void manager.signinRedirect({
      extraQueryParams: { identity_provider: 'Google' },
    });
  }

  function handleCognito() {
    const manager = getOidcManager();
    void manager.signinRedirect(returnTo ? { state: { returnTo } } : undefined);
  }

  return (
    <SpaceBetween size="s">
      <Button variant="primary" fullWidth onClick={handleGoogle}>
        Sign in with Google
      </Button>
      <Button fullWidth onClick={handleCognito}>
        Sign in with Cognito
      </Button>
    </SpaceBetween>
  );
}

export default function SignInPage() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '48px 16px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Container
          header={
            <Header variant="h1" description="Sign in to track your spending.">
              Cashight
            </Header>
          }
        >
          <SpaceBetween size="l">
            <Box>
              <StatusIndicator type="success">Private single-user workspace</StatusIndicator>
            </Box>
            <Suspense fallback={null}>
              <SignInError />
            </Suspense>
            <Suspense fallback={null}>
              <SignInActions />
            </Suspense>
          </SpaceBetween>
        </Container>
      </div>
    </main>
  );
}
