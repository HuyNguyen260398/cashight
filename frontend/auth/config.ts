export interface PublicRuntimeConfig {
  apiBaseUrl: string;
  cognitoAuthority: string;
  cognitoClientId: string;
  appOrigin: string;
}

/**
 * True when the app is running against the local dev API
 * (`pnpm dev:local`), which synthesizes claims instead of validating a
 * Cognito token — so there is no OIDC session to establish.
 *
 * The `NODE_ENV !== 'production'` guard is deliberate: `next build` inlines
 * both values, leaving `false && ...` for the bundler to eliminate. Setting
 * NEXT_PUBLIC_DEV_AUTH_BYPASS in a production build therefore does nothing.
 */
export function isDevAuthBypass(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'
  );
}

/**
 * Read and validate the NEXT_PUBLIC_* env vars that are baked in at build
 * time. Throws on first call when any value is absent, or when a value
 * is not an HTTPS URL in non-test environments.
 */
export function getPublicConfig(): PublicRuntimeConfig {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const cognitoAuthority = process.env.NEXT_PUBLIC_COGNITO_AUTHORITY ?? '';
  const cognitoClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '';
  const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? '';

  // Under the local bypass only the API base URL matters; requiring the
  // Cognito values would mean copying a real user-pool config just to parse
  // a PDF offline.
  const missing = (
    isDevAuthBypass()
      ? ([!apiBaseUrl && 'NEXT_PUBLIC_API_BASE_URL'] as (string | false)[])
      : ([
          !apiBaseUrl && 'NEXT_PUBLIC_API_BASE_URL',
          !cognitoAuthority && 'NEXT_PUBLIC_COGNITO_AUTHORITY',
          !cognitoClientId && 'NEXT_PUBLIC_COGNITO_CLIENT_ID',
          !appOrigin && 'NEXT_PUBLIC_APP_ORIGIN',
        ] as (string | false)[])
  ).filter(Boolean) as string[];

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (process.env.NODE_ENV !== 'test') {
    // Local development runs the SPA over http://localhost against the deployed
    // API, so exempt localhost origins from the HTTPS requirement.
    const isLocalhostOrigin = (value: string) =>
      value.startsWith('http://localhost') ||
      value.startsWith('http://127.0.0.1');

    const httpsCheck: [string, string][] = [
      [apiBaseUrl, 'NEXT_PUBLIC_API_BASE_URL'],
      [cognitoAuthority, 'NEXT_PUBLIC_COGNITO_AUTHORITY'],
      [appOrigin, 'NEXT_PUBLIC_APP_ORIGIN'],
    ];
    for (const [value, name] of httpsCheck) {
      // Empty is only reachable under the dev bypass, where the value is
      // unused; the `missing` check above covers every other case.
      if (!value) continue;
      if (!value.startsWith('https://') && !isLocalhostOrigin(value)) {
        throw new Error(`${name} must use HTTPS in production`);
      }
    }
  }

  return { apiBaseUrl, cognitoAuthority, cognitoClientId, appOrigin };
}
