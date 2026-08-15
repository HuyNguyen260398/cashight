/**
 * Real Cognito access-token verification for the local dev server.
 *
 * In production, API Gateway's JWT authorizer validates the token and hands
 * the Lambda a `requestContext.authorizer.claims` object. `pnpm dev:local`
 * normally synthesizes those claims (see DEV_SUB), which is enough to test
 * the parse pipeline but tells you nothing about the auth path.
 *
 * With `NEXT_PUBLIC_DEV_AUTH_BYPASS` unset or `false`, the dev server routes
 * through here instead: the SPA signs in against the real user pool, and the
 * bearer token it sends is verified against that pool's JWKS before any
 * handler runs. The claims the handlers see are then the real ones.
 *
 * Local-only. Nothing in `scripts/local/` is imported by the app or bundled
 * into a Lambda.
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { AuthProvider } from '@cashight/domain/workspace';

import { providerFromSignedUsername } from '../../backend/shared/auth-claims';

/** Claims shape the handlers read off `requestContext.authorizer`. */
export interface AuthorizerClaims {
  sub: string;
  token_use: 'access';
  scope: string;
  username?: string;
}

export class LocalAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalAuthError';
  }
}

/**
 * Pull the user pool id out of the OIDC issuer URL the SPA already uses
 * (`https://cognito-idp.{region}.amazonaws.com/{userPoolId}`), so real Cognito
 * mode needs no env var the frontend does not already require.
 */
export function userPoolIdFromAuthority(authority: string): string {
  const match = /^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/([a-zA-Z0-9_-]+)\/?$/.exec(
    authority.trim(),
  );
  if (!match) {
    throw new LocalAuthError(
      `NEXT_PUBLIC_COGNITO_AUTHORITY is not a Cognito issuer URL: ${authority || '(empty)'}`,
    );
  }
  return match[1];
}

/** The bearer token from an `Authorization` header, or undefined. */
export function bearerToken(headerValue: string | string[] | undefined): string | undefined {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : undefined;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<AuthorizerClaims>;
}

/** Just the read side of `process.env`, so tests can pass a plain object. */
export type EnvLike = Partial<Record<string, string>>;

/**
 * Which identity provider the caller signed in with.
 *
 * This decides an authorization gate — only native Cognito users may reach AWS
 * Cost Explorer (`cost-explorer-api/handler.ts` and `session-capabilities-api`
 * both check `authProvider === 'COGNITO'`) — so it must never be assumed.
 *
 * Production derives it in the Cognito TokenGeneration trigger from the
 * `identities` user attribute (`auth-guard/handler.ts:deriveAuthProvider`).
 * That attribute is not in the access token, so here it comes from `username`,
 * using the same rule the legacy authorization path already applies. Unknown
 * shapes fail closed rather than defaulting to the privileged provider.
 */
export function authProviderFromClaims(claims: { username?: string }): AuthProvider {
  const provider = providerFromSignedUsername(claims.username);
  if (!provider) {
    throw new LocalAuthError(
      `Cannot determine the identity provider from username ${
        claims.username === undefined ? '(absent)' : JSON.stringify(claims.username)
      }; refusing to authorize.`,
    );
  }
  return provider;
}

/**
 * Build a verifier for the pool the SPA signs in to. Throws at construction
 * when the Cognito env vars are missing, so the dev server fails at boot with
 * a clear message rather than 401ing every request.
 */
export function createCognitoVerifier(env: EnvLike = process.env): AccessTokenVerifier {
  const authority = env.NEXT_PUBLIC_COGNITO_AUTHORITY ?? '';
  const clientId = env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '';
  if (!clientId) {
    throw new LocalAuthError(
      'NEXT_PUBLIC_COGNITO_CLIENT_ID is required for real Cognito mode.',
    );
  }

  const verifier = CognitoJwtVerifier.create({
    userPoolId: userPoolIdFromAuthority(authority),
    clientId,
    tokenUse: 'access',
  });

  return {
    async verify(token: string): Promise<AuthorizerClaims> {
      let payload;
      try {
        payload = await verifier.verify(token);
      } catch (error) {
        throw new LocalAuthError(
          `Access token rejected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!sub) throw new LocalAuthError('Access token carries no sub claim.');
      const username =
        typeof payload.username === 'string' ? payload.username.trim() : '';
      return {
        sub,
        token_use: 'access',
        scope: typeof payload.scope === 'string' ? payload.scope : '',
        ...(username ? { username } : {}),
      };
    },
  };
}
