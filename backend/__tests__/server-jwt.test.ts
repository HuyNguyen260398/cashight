import { createSign, generateKeyPairSync } from 'node:crypto';
import { FetchError } from 'aws-jwt-verify/error';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import { describe, expect, it } from 'vitest';

import {
  AuthError,
  VerifierUnavailableError,
  bearerToken,
  createAccessTokenVerifier,
  verifierConfigFromEnv,
} from '../server/jwt';

const USER_POOL_ID = 'ap-southeast-1_TestPool';
const ISSUER = `https://cognito-idp.ap-southeast-1.amazonaws.com/${USER_POOL_ID}`;
const CLIENT_ID = 'spa-client';
const KID = 'test-key';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = {
  keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }],
};

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const payload = base64url({
    sub: 'user-123',
    iss: ISSUER,
    client_id: CLIENT_ID,
    token_use: 'access',
    scope: 'cashight/read cashight/write',
    username: 'huy',
    iat: now,
    exp: now + 300,
    ...overrides,
  });
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey)
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const verifier = createAccessTokenVerifier(
  { userPoolId: USER_POOL_ID, clientIds: [CLIENT_ID, 'smoke-client'] },
  { jwks },
);

describe('createAccessTokenVerifier', () => {
  it('returns the claims handlers read', async () => {
    await expect(verifier.verify(signToken())).resolves.toEqual({
      sub: 'user-123',
      token_use: 'access',
      scope: 'cashight/read cashight/write',
      username: 'huy',
    });
  });

  it('accepts any configured client id', async () => {
    const claims = await verifier.verify(signToken({ client_id: 'smoke-client' }));
    expect(claims.sub).toBe('user-123');
  });

  it('omits username when the token has none', async () => {
    const claims = await verifier.verify(signToken({ username: undefined }));
    expect(claims).not.toHaveProperty('username');
  });

  it.each([
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['an ID token', { token_use: 'id', aud: CLIENT_ID }],
    ['a token for another client', { client_id: 'someone-else' }],
    ['a token from another pool', { iss: `${ISSUER}x` }],
    ['a token with a blank sub', { sub: '   ' }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(verifier.verify(signToken(overrides))).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects a tampered signature', async () => {
    const token = signToken();
    await expect(verifier.verify(`${token.slice(0, -4)}AAAA`)).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects garbage', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(AuthError);
  });

  it('does not echo the token in the error message', async () => {
    const token = signToken({ client_id: 'someone-else' });
    const error = await verifier.verify(token).catch((caught: unknown) => caught);
    expect((error as Error).message).not.toContain(token);
  });
});

function verifierWithFetcher(fetch: () => Promise<ArrayBuffer>) {
  return createAccessTokenVerifier(
    { userPoolId: USER_POOL_ID, clientIds: [CLIENT_ID] },
    { jwksCache: new SimpleJwksCache({ fetcher: { fetch } }) },
  );
}

describe('JWKS retrieval', () => {
  it('reports an unreachable JWKS endpoint as unavailable, not as a bad token', async () => {
    const unreachable = verifierWithFetcher(async () => {
      throw new FetchError('jwks', 'connect ECONNREFUSED');
    });
    const error = await unreachable.verify(signToken()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VerifierUnavailableError);
    expect(error).not.toBeInstanceOf(AuthError);
  });

  it('still rejects a kid missing from a successfully fetched JWKS as a bad token', async () => {
    const empty = verifierWithFetcher(async () =>
      new TextEncoder().encode(JSON.stringify({ keys: [] })).buffer as ArrayBuffer,
    );
    await expect(empty.verify(signToken())).rejects.toBeInstanceOf(AuthError);
  });

  it('fails closed to 401 on an error it does not recognise', async () => {
    const odd = verifierWithFetcher(async () => {
      throw new TypeError('something unexpected');
    });
    await expect(odd.verify(signToken())).rejects.toBeInstanceOf(AuthError);
  });
});

describe('bearerToken', () => {
  it('extracts a bearer token', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme', () => {
    expect(bearerToken('bearer abc')).toBe('abc');
  });

  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer   '])('returns undefined for %j', (value) => {
    expect(bearerToken(value)).toBeUndefined();
  });

  it('uses the first value of a repeated header', () => {
    expect(bearerToken(['Bearer one', 'Bearer two'])).toBe('one');
  });
});

describe('verifierConfigFromEnv', () => {
  it('reads the pool id and a comma-separated client list', () => {
    expect(
      verifierConfigFromEnv({
        COGNITO_USER_POOL_ID: ' ap-southeast-1_abc ',
        COGNITO_CLIENT_IDS: 'one, two,,',
      }),
    ).toEqual({ userPoolId: 'ap-southeast-1_abc', clientIds: ['one', 'two'] });
  });

  it('throws when the pool id is missing', () => {
    expect(() => verifierConfigFromEnv({ COGNITO_CLIENT_IDS: 'one' })).toThrow(
      'Missing required configuration: COGNITO_USER_POOL_ID',
    );
  });

  it('throws when no client id is configured', () => {
    expect(() =>
      verifierConfigFromEnv({ COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_IDS: ' , ' }),
    ).toThrow('Missing required configuration: COGNITO_CLIENT_IDS');
  });
});
