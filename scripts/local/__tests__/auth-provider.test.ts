import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalAuthError, authProviderFromClaims } from '../cognito-auth';

let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cashight-authprovider-'));
  process.env.LOCAL_DATA_DIR = dataDir;
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  delete process.env.LOCAL_DATA_DIR;
});

describe('authProviderFromClaims', () => {
  it('reads GOOGLE off a federated access token', () => {
    expect(authProviderFromClaims({ username: 'Google_123456789' })).toBe('GOOGLE');
  });

  it('reads COGNITO off a native access token', () => {
    expect(authProviderFromClaims({ username: 'native-user-123' })).toBe('COGNITO');
  });

  // Fails closed: this decides an authorization gate, so an unrecognised
  // username must not fall back to the privileged provider.
  it.each([undefined, '', 'Google_', 'Facebook_123', 'OIDC_123'])(
    'refuses to guess a provider for username %j',
    (username) => {
      expect(() => authProviderFromClaims({ username })).toThrow(LocalAuthError);
    },
  );
});

/**
 * The reported bug: signing in with Google let the AWS Cost Explorer dashboard
 * through, because the local stack stamped every auto-seeded sub as COGNITO.
 */
describe('AWS cost access by auth provider', () => {
  const event = (sub: string, path: string, body: unknown) => ({
    httpMethod: 'POST',
    path,
    pathParameters: {},
    queryStringParameters: {},
    headers: {},
    body: body === null ? null : JSON.stringify(body),
    requestContext: {
      requestId: 'test',
      authorizer: {
        claims: { sub, token_use: 'access', scope: 'cashight/read cashight/write' },
      },
    },
  });

  const report = {
    mode: 'STANDARD',
    timePeriod: { start: '2026-07-01', end: '2026-08-01' },
    granularity: 'MONTHLY',
    metric: 'UnblendedCost',
    groupBy: [],
    chartStyle: 'BAR',
    showForecast: false,
    showOnlyUntagged: false,
    showOnlyUncategorized: false,
  };

  it('denies a Google-seeded sub', async () => {
    const { createLocalHandlers, seedAuthorizedUser } = await import('../handlers');
    const handlers = createLocalHandlers({ apiBaseUrl: 'http://localhost:8787' });
    await seedAuthorizedUser('google-sub', 'GOOGLE');

    const capabilities = await handlers.sessionCapabilities({
      ...event('google-sub', '/session/capabilities', null),
      httpMethod: 'GET',
    });
    expect(JSON.parse(capabilities.body)).toEqual({
      canViewAwsCosts: false,
      reason: 'COGNITO_REAUTH_REQUIRED',
    });

    const query = await handlers.costExplorer(
      event('google-sub', '/aws/cost-explorer/query', { request: report }),
    );
    expect(query.statusCode).toBe(403);
    expect(JSON.parse(query.body).error.code).toBe('COGNITO_REAUTH_REQUIRED');
  });

  it('allows a Cognito-seeded sub', async () => {
    const { createLocalHandlers, seedAuthorizedUser } = await import('../handlers');
    const handlers = createLocalHandlers({ apiBaseUrl: 'http://localhost:8787' });
    await seedAuthorizedUser('cognito-sub', 'COGNITO');

    const capabilities = await handlers.sessionCapabilities({
      ...event('cognito-sub', '/session/capabilities', null),
      httpMethod: 'GET',
    });
    expect(JSON.parse(capabilities.body)).toEqual({ canViewAwsCosts: true });

    const query = await handlers.costExplorer(
      event('cognito-sub', '/aws/cost-explorer/query', { request: report }),
    );
    expect(query.statusCode).toBe(200);
  });
});
