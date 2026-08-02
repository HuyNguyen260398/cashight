import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The local dev bypass (`pnpm dev:local`) skips Cognito entirely, so its
 * production-inertness is a security property, not a convenience: these tests
 * are what stop a stray NEXT_PUBLIC_DEV_AUTH_BYPASS=true in a deploy
 * environment from shipping an app that trusts nobody's token.
 */

// NODE_ENV is typed as a readonly literal union, so it is stubbed separately
// from the plain string flag rather than through a shared loop.
type NodeEnv = 'development' | 'production' | 'test';

const originalBypass = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS;

async function loadConfig(nodeEnv: NodeEnv, bypass?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (bypass === undefined) delete process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS;
  else vi.stubEnv('NEXT_PUBLIC_DEV_AUTH_BYPASS', bypass);
  vi.resetModules();
  return import('../auth/config');
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalBypass === undefined) delete process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS;
  else process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = originalBypass;
});

describe('isDevAuthBypass', () => {
  it('is on only when explicitly enabled outside production', async () => {
    const { isDevAuthBypass } = await loadConfig('development', 'true');
    expect(isDevAuthBypass()).toBe(true);
  });

  it('is off in a production build even when the flag is set', async () => {
    const { isDevAuthBypass } = await loadConfig('production', 'true');
    expect(isDevAuthBypass()).toBe(false);
  });

  it('is off when the flag is absent or not exactly "true"', async () => {
    for (const value of [undefined, 'false', '1', 'TRUE']) {
      const { isDevAuthBypass } = await loadConfig('development', value);
      expect(isDevAuthBypass(), `flag=${String(value)}`).toBe(false);
    }
  });
});

describe('getPublicConfig under the bypass', () => {
  const cognito = {
    NEXT_PUBLIC_COGNITO_AUTHORITY: 'https://cognito.example.com',
    NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
    NEXT_PUBLIC_APP_ORIGIN: 'https://app.example.com',
  };

  it('needs only the API base URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:8787');
    for (const key of Object.keys(cognito)) vi.stubEnv(key, '');
    const { getPublicConfig } = await loadConfig('development', 'true');
    expect(getPublicConfig().apiBaseUrl).toBe('http://localhost:8787');
  });

  it('still requires the full Cognito config when the bypass is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.com');
    for (const key of Object.keys(cognito)) vi.stubEnv(key, '');
    const { getPublicConfig } = await loadConfig('development');
    expect(() => getPublicConfig()).toThrow(/NEXT_PUBLIC_COGNITO_AUTHORITY/);
  });

  it('keeps enforcing HTTPS on non-localhost origins', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.com');
    for (const [key, value] of Object.entries(cognito)) vi.stubEnv(key, value);
    vi.stubEnv('NEXT_PUBLIC_APP_ORIGIN', 'http://app.example.com');
    const { getPublicConfig } = await loadConfig('development');
    expect(() => getPublicConfig()).toThrow(/must use HTTPS/);
  });
});
