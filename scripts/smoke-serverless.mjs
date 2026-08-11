#!/usr/bin/env node
/**
 * smoke-serverless.mjs
 *
 * Smoke tests for the serverless deployment at next.cashight.nghuy.link and
 * api.cashight.nghuy.link. Baseline checks are unauthenticated. When a short-
 * lived native Cognito access token is supplied, the suite also verifies the
 * server-derived session capabilities response.
 *
 * Required environment variables:
 *   APP_URL  — base URL of the frontend (e.g. https://next.cashight.nghuy.link)
 *   API_URL  — base URL of the API    (e.g. https://api.cashight.nghuy.link)
 *
 * Optional environment variables:
 *   SMOKE_NATIVE_ACCESS_TOKEN — short-lived Cognito-native access token
 *   SMOKE_REQUIRE_NATIVE_AUTH — set to true for production verification
 *
 * Exit 0 = all checks passed
 * Exit 1 = one or more checks failed
 */

import https from 'node:https';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const APP_URL = (process.env.APP_URL ?? '').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? '').replace(/\/$/, '');
const NATIVE_ACCESS_TOKEN = process.env.SMOKE_NATIVE_ACCESS_TOKEN ?? '';
const REQUIRE_NATIVE_AUTH = process.env.SMOKE_REQUIRE_NATIVE_AUTH === 'true';

// ── HTTP client ───────────────────────────────────────────────────────────────

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: options.method ?? 'GET',
        // Send the same identifying header a real HTTP client supplies. It also
        // keeps the smoke request useful if an edge filter is reintroduced.
        headers: { 'User-Agent': 'cashight-smoke-tests/1.0', ...(options.headers ?? {}) },
        timeout: 15000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout: ${url}`));
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────

const results = [];

class SmokeSkip extends Error {}

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.push({ name, passed: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof SmokeSkip) {
      console.log(`  - ${name} skipped (${msg})`);
      results.push({ name, passed: false, skipped: true, reason: msg });
      return;
    }
    console.error(`  ✗ ${name}: ${msg}`);
    results.push({ name, passed: false, error: msg });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function requireNativeAccessToken(nativeToken, required) {
  if (required && !nativeToken) {
    throw new Error(
      'SMOKE_NATIVE_ACCESS_TOKEN is required when SMOKE_REQUIRE_NATIVE_AUTH=true',
    );
  }
  return nativeToken;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function buildHistoricalCostExplorerRequest(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1),
  );
  return {
    mode: 'STANDARD',
    timePeriod: { start: isoDate(start), end: isoDate(end) },
    granularity: 'MONTHLY',
    metric: 'UnblendedCost',
    groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
    chartStyle: 'STACK',
    showForecast: false,
    showOnlyUntagged: false,
    showOnlyUncategorized: false,
  };
}

function parsedBody(response, label) {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function costExplorerDisabledReason(response) {
  if (response.status !== 424) return null;
  const body = parsedBody(response, 'Cost Explorer query');
  return body?.error?.code === 'COST_EXPLORER_DISABLED'
    ? 'AWS Cost Explorer is not enabled in the target account.'
    : null;
}

function containsSensitiveCostData(value, nativeToken) {
  const sensitiveKeys = new Set([
    'accesstoken',
    'token',
    'credentials',
    'secret',
    'password',
    'accesskey',
    'secretaccesskey',
    'accountid',
    'linkedaccount',
    'billingviewarn',
    'request',
    'filter',
  ]);
  const visit = (current) => {
    if (typeof current === 'string') {
      return (
        (nativeToken.length > 0 && current.includes(nativeToken)) ||
        /(?:^|\D)\d{12}(?:\D|$)/.test(current)
      );
    }
    if (Array.isArray(current)) return current.some(visit);
    if (!current || typeof current !== 'object') return false;
    return Object.entries(current).some(([key, child]) => {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
      return sensitiveKeys.has(normalized) || visit(child);
    });
  };
  return visit(value);
}

export function inspectCostExplorerSmokeResponses(
  firstResponse,
  secondResponse,
  nativeToken,
) {
  const disabledReason = costExplorerDisabledReason(firstResponse);
  if (disabledReason) return { status: 'SKIPPED', reason: disabledReason };

  assert(firstResponse.status === 200, `Expected first query 200, got ${firstResponse.status}`);
  assert(secondResponse, 'Expected a second Cost Explorer query response');
  assert(secondResponse.status === 200, `Expected second query 200, got ${secondResponse.status}`);

  const first = parsedBody(firstResponse, 'First Cost Explorer query');
  const second = parsedBody(secondResponse, 'Second Cost Explorer query');
  assert(
    !containsSensitiveCostData(first, nativeToken) &&
      !containsSensitiveCostData(second, nativeToken),
    'Cost Explorer responses contained sensitive fields',
  );
  assert(first?.result?.source === 'AWS', 'Expected first query source AWS');
  assert(second?.result?.source === 'CACHE', 'Expected second query source CACHE');
  const firstTotal = first?.result?.overview?.total;
  const secondTotal = second?.result?.overview?.total;
  assert(
    typeof firstTotal === 'string' && firstTotal === secondTotal,
    'Expected identical overview totals',
  );
  return { status: 'PASSED', total: firstTotal };
}

// ── Smoke tests ───────────────────────────────────────────────────────────────

async function main() {
  if (!APP_URL) throw new Error('APP_URL env var is required');
  if (!API_URL) throw new Error('API_URL env var is required');
  requireNativeAccessToken(NATIVE_ACCESS_TOKEN, REQUIRE_NATIVE_AUTH);

  console.log(`\nSmoke tests`);
  console.log(`  APP: ${APP_URL}`);
  console.log(`  API: ${API_URL}\n`);

  // API health
  await check('GET /health returns 200', async () => {
    const res = await request(`${API_URL}/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // Unauthenticated API calls are rejected
  await check('GET /statements without auth returns 401', async () => {
    const res = await request(`${API_URL}/statements`);
    assert(
      res.status === 401,
      `Expected 401, got ${res.status}`,
    );
  });

  await check('GET /dashboard without auth returns 401', async () => {
    const res = await request(`${API_URL}/dashboard`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await check('GET /session/capabilities without auth returns 401', async () => {
    const res = await request(`${API_URL}/session/capabilities`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  if (NATIVE_ACCESS_TOKEN) {
    await check(
      'GET /session/capabilities returns native AWS capability only',
      async () => {
        const res = await request(`${API_URL}/session/capabilities`, {
          headers: { Authorization: `Bearer ${NATIVE_ACCESS_TOKEN}` },
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body = JSON.parse(res.body);
        assert(
          JSON.stringify(Object.keys(body).sort()) ===
            JSON.stringify(['canViewAwsCosts']),
          'Capabilities response contained unexpected keys',
        );
        assert(
          body.canViewAwsCosts === true,
          'Native session must receive canViewAwsCosts: true',
        );
      },
    );

    await check(
      'Cost Explorer bounded query returns AWS then identical CACHE totals',
      async () => {
        const reportRequest = buildHistoricalCostExplorerRequest();
        const headers = {
          Authorization: `Bearer ${NATIVE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        };
        const first = await request(`${API_URL}/aws/cost-explorer/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ request: reportRequest, refresh: true }),
        });
        const disabledReason = costExplorerDisabledReason(first);
        if (disabledReason) throw new SmokeSkip(disabledReason);
        const second = await request(`${API_URL}/aws/cost-explorer/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ request: reportRequest, refresh: false }),
        });
        inspectCostExplorerSmokeResponses(
          first,
          second,
          NATIVE_ACCESS_TOKEN,
        );
      },
    );
  } else {
    console.log(
      '  - authenticated capabilities check skipped (SMOKE_NATIVE_ACCESS_TOKEN not set)',
    );
    console.log(
      '  - authenticated Cost Explorer check skipped (SMOKE_NATIVE_ACCESS_TOKEN not set)',
    );
  }

  await check('POST /uploads without auth returns 401', async () => {
    const res = await request(`${API_URL}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Static SPA routes exist and serve HTML
  await check('GET / returns 200 with HTML', async () => {
    const res = await request(`${APP_URL}/`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      res.body.includes('<!DOCTYPE html') || res.body.includes('<html'),
      'Response is not HTML',
    );
  });

  await check('GET /signin/ returns 200 with HTML', async () => {
    const res = await request(`${APP_URL}/signin/`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      res.body.includes('<!DOCTYPE html') || res.body.includes('<html'),
      'Response is not HTML',
    );
  });

  await check('GET /upload/ returns 200 with HTML', async () => {
    const res = await request(`${APP_URL}/upload/`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      res.body.includes('<!DOCTYPE html') || res.body.includes('<html'),
      'Response is not HTML',
    );
  });

  await check('GET /statements/ returns 200 with HTML', async () => {
    const res = await request(`${APP_URL}/statements/`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      res.body.includes('<!DOCTYPE html') || res.body.includes('<html'),
      'Response is not HTML',
    );
  });

  for (const route of ['/aws/cost-explorer/', '/aws/billing-invoice/']) {
    await check(`GET ${route} returns 200 with HTML`, async () => {
      const res = await request(`${APP_URL}${route}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(
        res.body.includes('<!DOCTYPE html') || res.body.includes('<html'),
        'Response is not HTML',
      );
    });
  }

  // Auth deep-link: /auth/callback/ should return HTML (not 404)
  await check('GET /auth/callback/ returns 200 with HTML', async () => {
    const res = await request(`${APP_URL}/auth/callback/`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      res.body.includes('<!DOCTYPE html') || res.body.includes('<html'),
      'Response is not HTML',
    );
  });

  // Security headers on static responses
  await check('Static response includes security headers', async () => {
    const res = await request(`${APP_URL}/`);
    const headers = res.headers;
    assert(
      headers['x-frame-options'] || headers['content-security-policy'],
      'Missing X-Frame-Options or Content-Security-Policy header',
    );
    assert(
      headers['x-content-type-options'] === 'nosniff',
      'Missing X-Content-Type-Options: nosniff',
    );
  });

  // Results
  const passed = results.filter((r) => r.passed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.passed && !r.skipped).length;
  console.log(
    `\n${passed}/${results.length - skipped} checks passed${skipped ? ` (${skipped} skipped)` : ''}`,
  );

  if (failed > 0) {
    console.error(`${failed} check(s) failed — deployment is unhealthy`);
    process.exitCode = 1;
  } else {
    console.log('All smoke tests passed');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(
      `Smoke test runner failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  });
}
