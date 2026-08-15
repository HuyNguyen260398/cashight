import { describe, expect, it } from 'vitest';

import {
  LocalAuthError,
  bearerToken,
  createCognitoVerifier,
  userPoolIdFromAuthority,
} from '../cognito-auth';

describe('userPoolIdFromAuthority', () => {
  it('extracts the pool id from the OIDC issuer the SPA already uses', () => {
    expect(
      userPoolIdFromAuthority(
        'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_ZazpeBFju',
      ),
    ).toBe('ap-southeast-1_ZazpeBFju');
  });

  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(
      userPoolIdFromAuthority(
        '  https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123/  ',
      ),
    ).toBe('us-east-1_abc123');
  });

  it.each([
    ['', 'empty'],
    ['not-a-url', 'not a URL'],
    ['https://example.com/us-east-1_abc123', 'a non-Cognito host'],
    // The hosted-UI domain is a common mix-up: it is not the issuer.
    ['https://cashight-abc.auth.ap-southeast-1.amazoncognito.com', 'the hosted-UI domain'],
  ])('rejects %s (%s)', (authority) => {
    expect(() => userPoolIdFromAuthority(authority)).toThrow(LocalAuthError);
  });
});

describe('bearerToken', () => {
  it('reads the token out of an Authorization header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts any casing of the scheme', () => {
    expect(bearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('takes the first value when node hands back an array', () => {
    expect(bearerToken(['Bearer first', 'Bearer second'])).toBe('first');
  });

  const rejected: Array<[string | undefined, string]> = [
    [undefined, 'absent'],
    ['', 'empty'],
    ['abc.def.ghi', 'missing the scheme'],
    ['Basic dXNlcjpwYXNz', 'a different scheme'],
  ];
  it.each(rejected)('returns undefined when the header is %s (%s)', (header) => {
    expect(bearerToken(header)).toBeUndefined();
  });
});

describe('createCognitoVerifier', () => {
  it('fails fast when the client id is missing', () => {
    expect(() =>
      createCognitoVerifier({
        NEXT_PUBLIC_COGNITO_AUTHORITY:
          'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_ZazpeBFju',
      }),
    ).toThrow(/NEXT_PUBLIC_COGNITO_CLIENT_ID/);
  });

  it('fails fast when the authority is missing', () => {
    expect(() =>
      createCognitoVerifier({
        NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
      }),
    ).toThrow(/NEXT_PUBLIC_COGNITO_AUTHORITY/);
  });

  it('builds a verifier from valid config without contacting Cognito', () => {
    const verifier = createCognitoVerifier({
      NEXT_PUBLIC_COGNITO_AUTHORITY:
        'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_ZazpeBFju',
      NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
    });
    expect(typeof verifier.verify).toBe('function');
  });

  it('wraps a rejected token as LocalAuthError rather than leaking the JWT internals', async () => {
    const verifier = createCognitoVerifier({
      NEXT_PUBLIC_COGNITO_AUTHORITY:
        'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_ZazpeBFju',
      NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
    });
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(LocalAuthError);
  });
});
