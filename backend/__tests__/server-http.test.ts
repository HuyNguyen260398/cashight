import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../shared/api-response';
import { createApiServer, type ApiHandler, type ApiServerOptions } from '../server/http-server';
import { AuthError, type AccessTokenVerifier } from '../server/jwt';

const CLAIMS = { sub: 'user-123', token_use: 'access' as const, scope: 'cashight/read' };

const verifier: AccessTokenVerifier = {
  verify: async (token) => {
    if (token !== 'good') throw new AuthError('Access token rejected (test).');
    return CLAIMS;
  },
};

let server: http.Server | undefined;

async function start(overrides: Partial<ApiServerOptions> = {}): Promise<string> {
  server = createApiServer({
    handlers: { dashboard: async () => jsonResponse(200, { ok: true }) },
    verifier,
    rateLimiter: { take: () => true },
    ...overrides,
  });
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

const auth = { Authorization: 'Bearer good' };

interface ProxyEvent {
  httpMethod: string;
  path: string;
  pathParameters: Record<string, string>;
  queryStringParameters: Record<string, string>;
  body: string | null;
  requestContext: { requestId: string; authorizer: { claims: unknown } };
}

interface ErrorBody {
  error: { code: string; retryable?: boolean };
}

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

describe('probes', () => {
  it('answers /healthz without auth', async () => {
    const res = await fetch(`${await start()}/healthz`);
    expect(res.status).toBe(200);
  });

  it('answers /readyz 503 when not ready', async () => {
    const res = await fetch(`${await start({ isReady: () => false })}/readyz`);
    expect(res.status).toBe(503);
  });

  it('answers probes even when the limiter is empty', async () => {
    const res = await fetch(`${await start({ rateLimiter: { take: () => false } })}/healthz`);
    expect(res.status).toBe(200);
  });

  it('answers /health like the API Gateway mock did', async () => {
    const res = await fetch(`${await start()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://cashight.nghuy.link');
  });
});

describe('CORS', () => {
  it('answers preflight without auth', async () => {
    const res = await fetch(`${await start()}/dashboard`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://cashight.nghuy.link');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, DELETE, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(res.headers.get('access-control-max-age')).toBe('300');
  });

  it('puts the allowed origin on error responses', async () => {
    const res = await fetch(`${await start()}/dashboard`);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://cashight.nghuy.link');
  });
});

describe('authentication', () => {
  it.each([
    ['no header', {}],
    ['a bad token', { Authorization: 'Bearer bad' }],
    ['a non-bearer scheme', { Authorization: 'Basic good' }],
  ])('returns 401 for %s and never calls the handler', async (_label, headers) => {
    const dashboard = vi.fn<ApiHandler>();
    const res = await fetch(`${await start({ handlers: { dashboard } })}/dashboard`, { headers });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('UNAUTHORIZED');
    expect(dashboard).not.toHaveBeenCalled();
  });
});

describe('dispatch', () => {
  it('builds the API Gateway proxy event the handlers expect', async () => {
    const statements = vi.fn<ApiHandler>(async () => jsonResponse(200, {}));
    const base = await start({ handlers: { statements } });
    await fetch(`${base}/statements/9674-2026-05?bank=VIB`, { method: 'DELETE', headers: auth });
    const event = statements.mock.calls[0][0] as ProxyEvent;
    expect(event.httpMethod).toBe('DELETE');
    expect(event.path).toBe('/statements/9674-2026-05');
    expect(event.pathParameters).toEqual({ statementId: '9674-2026-05' });
    expect(event.queryStringParameters).toEqual({ bank: 'VIB' });
    expect(event.body).toBeNull();
    expect(event.requestContext.authorizer.claims).toEqual(CLAIMS);
    expect(event.requestContext.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('passes the request body as a string', async () => {
    const uploads = vi.fn<ApiHandler>(async () => jsonResponse(201, {}));
    const base = await start({ handlers: { uploads } });
    const res = await fetch(`${base}/uploads`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'a.pdf' }),
    });
    expect(res.status).toBe(201);
    expect((uploads.mock.calls[0][0] as ProxyEvent).body).toBe('{"fileName":"a.pdf"}');
  });

  it('returns the handler status, headers and body unchanged', async () => {
    const base = await start({
      handlers: { dashboard: async () => jsonResponse(409, { error: { code: 'CONFLICT' } }) },
    });
    const res = await fetch(`${base}/dashboard`, { headers: auth });
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ error: { code: 'CONFLICT' } });
  });

  it('returns 404 for a route owned by the other service', async () => {
    const res = await fetch(`${await start()}/aws/invoices`, { headers: auth });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('NOT_FOUND');
  });

  it('returns 404 for a malformed percent-encoded path', async () => {
    const statements = vi.fn<ApiHandler>();
    const base = await start({ handlers: { statements } });
    const res = await fetch(`${base}/statements/%E0%A4%A`, { headers: auth });
    expect(res.status).toBe(404);
    expect(statements).not.toHaveBeenCalled();
  });

  it('returns 404 for an unsupported method', async () => {
    const res = await fetch(`${await start()}/dashboard`, { method: 'PUT', headers: auth });
    expect(res.status).toBe(404);
  });
});

describe('limits and failures', () => {
  it('returns 429 with Retry-After when the limiter is empty', async () => {
    const dashboard = vi.fn<ApiHandler>();
    const base = await start({ handlers: { dashboard }, rateLimiter: { take: () => false } });
    const res = await fetch(`${base}/dashboard`, { headers: auth });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('1');
    expect(await errorOf(res)).toMatchObject({ code: 'TOO_MANY_REQUESTS', retryable: true });
    expect(dashboard).not.toHaveBeenCalled();
  });

  it('returns 413 for a body over the limit and never calls the handler', async () => {
    const uploads = vi.fn<ApiHandler>();
    const base = await start({ handlers: { uploads }, maxBodyBytes: 16 });
    const res = await fetch(`${base}/uploads`, {
      method: 'POST',
      headers: auth,
      body: 'x'.repeat(1024),
    });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('PAYLOAD_TOO_LARGE');
    expect(uploads).not.toHaveBeenCalled();
  });

  it('returns a generic 500 when a handler throws, without leaking the message', async () => {
    const base = await start({
      handlers: {
        dashboard: async () => {
          throw new Error('card 4111111111111111 exploded');
        },
      },
    });
    const res = await fetch(`${base}/dashboard`, { headers: auth });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect((JSON.parse(text) as ErrorBody).error.code).toBe('INTERNAL_ERROR');
    expect(text).not.toContain('4111');
  });

  it('never logs the query string, token or thrown message', async () => {
    const base = await start({
      handlers: {
        dashboard: async () => {
          throw new Error('card 4111111111111111 exploded');
        },
      },
    });
    await fetch(`${base}/dashboard?secretish=zzz`, { headers: auth });
    const logged = vi.mocked(process.stdout.write).mock.calls.map((call) => String(call[0])).join('');
    expect(logged).toContain('"route":"dashboard"');
    expect(logged).not.toContain('zzz');
    expect(logged).not.toContain('good');
    expect(logged).not.toContain('4111');
  });
});
