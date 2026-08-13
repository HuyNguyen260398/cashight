import { MetricUnit } from '@aws-lambda-powertools/metrics';
import type { AuthProvider } from '@cashight/domain/workspace';

import { ApiError } from './api-response';
import { dynamoDocumentClient } from './clients';
import { requiredEnvironmentValue } from './config';
import {
  getAuthorizedUser,
  parseLegacyAuthorizedUserRecord,
  parseAuthorizedUserRecord,
  type AuthorizedUserRecord,
} from './metadata';
import { metrics } from './observability';

export type RequiredScope = 'cashight/read' | 'cashight/write';

export interface AccessClaims {
  sub: string;
  username?: string;
  scopes: ReadonlySet<string>;
}

interface AuthorizeDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  enableLegacyAuthzFallback?: boolean;
  onLegacyFallback?: () => void;
}

function authorizerClaims(event: unknown): Record<string, unknown> | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const requestContext = (event as { requestContext?: unknown }).requestContext;
  if (typeof requestContext !== 'object' || requestContext === null) {
    return undefined;
  }
  const authorizer = (requestContext as { authorizer?: unknown }).authorizer;
  if (typeof authorizer !== 'object' || authorizer === null) {
    return undefined;
  }
  const claims = (authorizer as { claims?: unknown }).claims;
  return typeof claims === 'object' && claims !== null
    ? (claims as Record<string, unknown>)
    : undefined;
}

export function extractAccessClaims(
  event: unknown,
  requiredScope: RequiredScope,
): AccessClaims {
  const claims = authorizerClaims(event);
  const sub = typeof claims?.sub === 'string' ? claims.sub.trim() : '';
  if (!sub || claims?.token_use !== 'access') {
    throw new ApiError('UNAUTHORIZED', 401, 'Authentication is required.');
  }

  const scope = typeof claims.scope === 'string' ? claims.scope : '';
  const scopes = new Set(scope.split(/\s+/).filter(Boolean));
  if (!scopes.has(requiredScope)) {
    throw new ApiError('FORBIDDEN', 403, 'Access denied.');
  }
  const username =
    typeof claims.username === 'string' ? claims.username.trim() : '';
  return { sub, ...(username ? { username } : {}), scopes };
}

/**
 * Derive the identity provider from an access token's `username` claim.
 * Cognito prefixes federated usernames with the IdP name, so `Google_<sub>`
 * is a Google sign-in and a bare username is a native pool user.
 *
 * Returns undefined rather than guessing when the username is absent or does
 * not match either shape — callers gate authorization on this, so an
 * unrecognised value must never resolve to the privileged provider.
 */
export function providerFromSignedUsername(
  username: string | undefined,
): AuthProvider | undefined {
  if (!username) return undefined;
  if (/^Google_[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(username)) return 'GOOGLE';
  if (/^[A-Za-z0-9][A-Za-z0-9.@:-]{0,127}$/.test(username)) return 'COGNITO';
  return undefined;
}

function legacyAuthorization(
  value: unknown,
  username: string | undefined,
): AuthorizedUserRecord | undefined {
  const record = parseLegacyAuthorizedUserRecord(value);
  const authProvider = providerFromSignedUsername(username);
  if (!record || !authProvider) return undefined;
  return {
    ...record,
    workspaceId: 'primary',
    authProvider,
  };
}

function defaultDependencies(): AuthorizeDependencies {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  return {
    getAuthorizedUser: (sub) =>
      getAuthorizedUser(dynamoDocumentClient, tableName, sub),
  };
}

export async function authorizeRequest(
  event: unknown,
  requiredScope: RequiredScope,
  dependencies: AuthorizeDependencies = defaultDependencies(),
): Promise<{ claims: AccessClaims; authorization: AuthorizedUserRecord }> {
  const claims = extractAccessClaims(event, requiredScope);
  const rawAuthorization = await dependencies.getAuthorizedUser(claims.sub);
  let authorization = parseAuthorizedUserRecord(rawAuthorization);
  const enableLegacyAuthzFallback =
    dependencies.enableLegacyAuthzFallback ??
    process.env.ENABLE_LEGACY_AUTHZ_FALLBACK === 'true';
  if (!authorization && enableLegacyAuthzFallback) {
    authorization = legacyAuthorization(rawAuthorization, claims.username);
    if (authorization) {
      (dependencies.onLegacyFallback ?? (() => {
        metrics.addMetric('LegacyAuthzFallback', MetricUnit.Count, 1);
      }))();
    }
  }
  if (!authorization) {
    throw new ApiError('FORBIDDEN', 403, 'Access denied.');
  }
  return { claims, authorization };
}
