import { describe, expect, it } from 'vitest';

import { ALLOWED_ORIGIN, allowedOriginFromEnv } from '../shared/api-response';

describe('allowedOriginFromEnv', () => {
  it.each([{}, { ALLOWED_ORIGIN: '' }, { ALLOWED_ORIGIN: '   ' }])(
    'defaults to the production origin for %j',
    (env) => {
      expect(allowedOriginFromEnv(env)).toBe('https://cashight.nghuy.link');
    },
  );

  it('accepts the hostname the new stack runs on during the rollout', () => {
    expect(allowedOriginFromEnv({ ALLOWED_ORIGIN: 'https://cashight-v2.nghuy.link' })).toBe(
      'https://cashight-v2.nghuy.link',
    );
  });

  it('ignores surrounding whitespace', () => {
    expect(allowedOriginFromEnv({ ALLOWED_ORIGIN: ' https://cashight-v2.nghuy.link\n' })).toBe(
      'https://cashight-v2.nghuy.link',
    );
  });

  it.each([
    '*',
    'null',
    'https://*.nghuy.link',
    'http://cashight-v2.nghuy.link',
    'cashight-v2.nghuy.link',
    'https://cashight-v2.nghuy.link/',
    'https://cashight-v2.nghuy.link/signin',
    'https://cashight-v2.nghuy.link:443',
    'https://CASHIGHT-V2.nghuy.link',
    'https://cashight.nghuy.link,https://cashight-v2.nghuy.link',
    'https://cashight.nghuy.link https://cashight-v2.nghuy.link',
  ])('refuses %j', (value) => {
    expect(() => allowedOriginFromEnv({ ALLOWED_ORIGIN: value })).toThrow(
      'Invalid configuration: ALLOWED_ORIGIN',
    );
  });
});

describe('ALLOWED_ORIGIN', () => {
  it('is the production origin when the variable is unset, as in every Lambda', () => {
    expect(ALLOWED_ORIGIN).toBe('https://cashight.nghuy.link');
  });
});
