/**
 * Cognito access-token verification for the container HTTP server.
 *
 * API Gateway's Cognito authorizer used to validate the token and attach
 * `requestContext.authorizer.claims`. This produces the same claims object, so
 * backend/shared/auth-claims.ts keeps enforcing scope and token_use unchanged.
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  FetchError,
  JwksNotAvailableInCacheError,
  WaitPeriodNotYetEndedJwkError,
} from 'aws-jwt-verify/error';
import type { SimpleJwksCache } from 'aws-jwt-verify/jwk';

import { requiredEnvironmentValue } from '../shared/config';

/** Claims shape the handlers read off `requestContext.authorizer`. */
export interface AuthorizerClaims {
  sub: string;
  token_use: 'access';
  scope: string;
  username?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * The token could not be judged because the signing keys could not be
 * retrieved (Cognito's JWKS endpoint is unreachable). This is an outage, not a
 * bad credential: answering 401 would sign the user out for our own failure.
 */
export class VerifierUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifierUnavailableError';
  }
}

/**
 * Key-retrieval failures in aws-jwt-verify. FetchError covers
 * NonRetryableFetchError. A kid missing from a JWKS that was fetched
 * successfully is deliberately not here: that is a bad token.
 */
function isKeyRetrievalFailure(error: unknown): boolean {
  return (
    error instanceof FetchError ||
    error instanceof JwksNotAvailableInCacheError ||
    error instanceof WaitPeriodNotYetEndedJwkError
  );
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<AuthorizerClaims>;
}

export interface VerifierConfig {
  userPoolId: string;
  clientIds: string[];
}

type Environment = Record<string, string | undefined>;

/** The bearer token from an `Authorization` header, or undefined. */
export function bearerToken(headerValue: string | string[] | undefined): string | undefined {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

export function verifierConfigFromEnv(env: Environment = process.env): VerifierConfig {
  const userPoolId = requiredEnvironmentValue('COGNITO_USER_POOL_ID', env);
  const clientIds = (env.COGNITO_CLIENT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (clientIds.length === 0) {
    throw new Error('Missing required configuration: COGNITO_CLIENT_IDS');
  }
  return { userPoolId, clientIds };
}

export function createAccessTokenVerifier(
  config: VerifierConfig,
  options: { jwks?: { keys: object[] }; jwksCache?: SimpleJwksCache } = {},
): AccessTokenVerifier {
  const verifier = CognitoJwtVerifier.create(
    {
      userPoolId: config.userPoolId,
      clientId: config.clientIds,
      tokenUse: 'access',
    },
    // Tests inject a cache whose fetcher fails, to simulate a JWKS outage.
    options.jwksCache ? { jwksCache: options.jwksCache } : undefined,
  );
  // Tests inject a JWKS; production fetches and caches the pool's JWKS lazily.
  if (options.jwks) verifier.cacheJwks(options.jwks as never);

  return {
    async verify(token: string): Promise<AuthorizerClaims> {
      let payload: Record<string, unknown>;
      try {
        payload = (await verifier.verify(token)) as Record<string, unknown>;
      } catch (error) {
        if (isKeyRetrievalFailure(error)) {
          throw new VerifierUnavailableError(`Token keys unavailable (${(error as Error).name}).`);
        }
        // Anything unrecognised fails closed to 401. The library's messages name the failed check, never the token.
        const reason = error instanceof Error ? error.name : 'unknown';
        throw new AuthError(`Access token rejected (${reason}).`);
      }
      const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!sub) throw new AuthError('Access token carries no sub claim.');
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      return {
        sub,
        token_use: 'access',
        scope: typeof payload.scope === 'string' ? payload.scope : '',
        ...(username ? { username } : {}),
      };
    },
  };
}
