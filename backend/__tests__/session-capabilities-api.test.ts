import { describe, expect, it, vi } from 'vitest';

import {
  createSessionCapabilitiesApiHandler,
  type SessionCapabilitiesApiDependencies,
} from '../functions/session-capabilities-api/handler';

function authorizationRecord(authProvider: 'COGNITO' | 'GOOGLE') {
  return {
    PK: 'AUTHZ#user-123' as const,
    SK: 'PROFILE' as const,
    active: true as const,
    workspaceId: 'primary' as const,
    authProvider,
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z',
  };
}

function event(scope = 'cashight/read cashight/write'): unknown {
  return {
    httpMethod: 'GET',
    path: '/session/capabilities',
    requestContext: {
      requestId: 'test-request-id',
      authorizer: {
        claims: {
          sub: 'user-123',
          username: 'native-user',
          token_use: 'access',
          scope,
        },
      },
    },
  };
}

function dependencies(
  authProvider: 'COGNITO' | 'GOOGLE',
): SessionCapabilitiesApiDependencies {
  return {
    getAuthorizedUser: vi
      .fn()
      .mockResolvedValue(authorizationRecord(authProvider)),
  };
}

describe('GET /session/capabilities', () => {
  it('allows native Cognito sessions to view AWS costs', async () => {
    const response = await createSessionCapabilitiesApiHandler(
      dependencies('COGNITO'),
    )(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ canViewAwsCosts: true });
  });

  it('returns the reauthentication reason for Google sessions', async () => {
    const response = await createSessionCapabilitiesApiHandler(
      dependencies('GOOGLE'),
    )(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      canViewAwsCosts: false,
      reason: 'COGNITO_REAUTH_REQUIRED',
    });
  });

  it('does not expose subject, workspace, provider, scopes, or authorization data', async () => {
    const response = await createSessionCapabilitiesApiHandler(
      dependencies('COGNITO'),
    )(event());
    const body = JSON.parse(response.body);

    expect(Object.keys(body)).toEqual(['canViewAwsCosts']);
    expect(JSON.stringify(body)).not.toMatch(
      /user-123|primary|COGNITO|cashight\/read/,
    );
  });

  it('requires the read scope', async () => {
    const response = await createSessionCapabilitiesApiHandler(
      dependencies('COGNITO'),
    )(event('cashight/write'));

    expect(response.statusCode).toBe(403);
  });

  it('rejects a missing authorization record', async () => {
    const response = await createSessionCapabilitiesApiHandler({
      getAuthorizedUser: vi.fn().mockResolvedValue(undefined),
    })(event());

    expect(response.statusCode).toBe(403);
  });
});
