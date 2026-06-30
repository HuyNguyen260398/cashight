import { ApiError } from './api-response';
import { dynamoDocumentClient } from './clients';
import { requiredEnvironmentValue } from './config';
import {
  getAuthorizedUser,
  parseAuthorizedUserRecord,
  type AuthorizedUserRecord,
} from './metadata';

export type RequiredScope = 'cashight/read' | 'cashight/write';

export interface AccessClaims {
  sub: string;
  scopes: ReadonlySet<string>;
}

interface AuthorizeDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
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
  return { sub, scopes };
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
  const authorization = parseAuthorizedUserRecord(
    await dependencies.getAuthorizedUser(claims.sub),
  );
  if (!authorization) {
    throw new ApiError('FORBIDDEN', 403, 'Access denied.');
  }
  return { claims, authorization };
}
