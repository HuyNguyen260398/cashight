import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertSameOrigin } from '@/lib/security/origin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('assertSameOrigin', () => {
  it('allows requests without an Origin header', () => {
    const request = new Request('http://localhost:3000/api/parse', {
      headers: { host: 'localhost:3000' },
    });

    expect(assertSameOrigin(request)).toBeNull();
  });

  it('allows matching Origin and Host headers', () => {
    const request = new Request('http://localhost:3000/api/parse', {
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      },
    });

    expect(assertSameOrigin(request)).toBeNull();
  });

  it('allows Amplify forwarded hosts', () => {
    const request = new Request('http://localhost:3000/api/parse', {
      headers: {
        host: 'localhost:3000',
        origin: 'https://main.d256g033y75nc0.amplifyapp.com',
        'x-forwarded-host': 'main.d256g033y75nc0.amplifyapp.com',
      },
    });

    expect(assertSameOrigin(request)).toBeNull();
  });

  it('allows the configured AUTH_URL host', () => {
    vi.stubEnv('AUTH_URL', 'https://cashight.example.com');
    const request = new Request('http://localhost:3000/api/parse', {
      headers: {
        host: 'localhost:3000',
        origin: 'https://cashight.example.com',
      },
    });

    expect(assertSameOrigin(request)).toBeNull();
  });

  it('rejects a cross-origin unsafe request', async () => {
    const request = new Request('http://localhost:3000/api/parse', {
      headers: {
        host: 'localhost:3000',
        origin: 'https://evil.example.com',
      },
    });

    const response = assertSameOrigin(request);
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: 'Invalid request origin',
    });
  });
});
