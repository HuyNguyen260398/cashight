import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiAllService } from '../server/api-all-service';
import { createApiServer } from '../server/http-server';
import { AuthError, type AccessTokenVerifier } from '../server/jwt';
import { aiSummaryEnabled } from '../shared/config';

const ALL_HANDLERS = [
  'awsInvoiceSummaries',
  'awsInvoices',
  'costExplorer',
  'dashboard',
  'sessionCapabilities',
  'statements',
  'summaries',
  'uploadStatus',
  'uploads',
];

describe('aiSummaryEnabled', () => {
  it.each([{}, { AI_SUMMARY_ENABLED: 'true' }, { AI_SUMMARY_ENABLED: 'FALSE' }, { AI_SUMMARY_ENABLED: '' }])(
    'is enabled for %o',
    (env) => {
      expect(aiSummaryEnabled(env)).toBe(true);
    },
  );

  it('is disabled only for exactly "false"', () => {
    expect(aiSummaryEnabled({ AI_SUMMARY_ENABLED: 'false' })).toBe(false);
  });
});

describe('apiAllService', () => {
  it('serves every route and needs both APIs config by default', () => {
    const { handlers, requiredEnv } = apiAllService({});
    expect(Object.keys(handlers).sort()).toEqual(ALL_HANDLERS);
    expect(requiredEnv).toEqual([
      'TABLE_NAME',
      'STATEMENTS_BUCKET',
      'UPLOAD_BUCKET',
      'EXPORT_BUCKET',
      'GEMINI_PARAM',
    ]);
  });

  it('drops both summary handlers and GEMINI_PARAM when AI summaries are off', () => {
    const { handlers, requiredEnv } = apiAllService({ AI_SUMMARY_ENABLED: 'false' });
    expect(Object.keys(handlers).sort()).toEqual(
      ALL_HANDLERS.filter((name) => name !== 'summaries' && name !== 'awsInvoiceSummaries'),
    );
    expect(requiredEnv).not.toContain('GEMINI_PARAM');
  });
});

describe('merged API with AI summaries off', () => {
  const verifier: AccessTokenVerifier = {
    verify: async (token) => {
      if (token !== 'good') throw new AuthError('Access token rejected (test).');
      return { sub: 'user-123', token_use: 'access' as const, scope: 'cashight/read' };
    },
  };
  let server: http.Server | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  it.each(['/summaries', '/aws/invoices/summary'])('answers 404 on POST %s', async (path) => {
    server = createApiServer({
      handlers: apiAllService({ AI_SUMMARY_ENABLED: 'false' }).handlers,
      verifier,
      rateLimiter: { take: () => true },
    });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});
