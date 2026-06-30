export interface PublicRuntimeConfig {
  apiBaseUrl: string;
  cognitoAuthority: string;
  cognitoClientId: string;
  appOrigin: string;
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

  const missing = (
    [
      !apiBaseUrl && 'NEXT_PUBLIC_API_BASE_URL',
      !cognitoAuthority && 'NEXT_PUBLIC_COGNITO_AUTHORITY',
      !cognitoClientId && 'NEXT_PUBLIC_COGNITO_CLIENT_ID',
      !appOrigin && 'NEXT_PUBLIC_APP_ORIGIN',
    ] as (string | false)[]
  ).filter(Boolean) as string[];

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (process.env.NODE_ENV !== 'test') {
    const httpsCheck: [string, string][] = [
      [apiBaseUrl, 'NEXT_PUBLIC_API_BASE_URL'],
      [cognitoAuthority, 'NEXT_PUBLIC_COGNITO_AUTHORITY'],
      [appOrigin, 'NEXT_PUBLIC_APP_ORIGIN'],
    ];
    for (const [value, name] of httpsCheck) {
      if (!value.startsWith('https://')) {
        throw new Error(`${name} must use HTTPS in production`);
      }
    }
  }

  return { apiBaseUrl, cognitoAuthority, cognitoClientId, appOrigin };
}
