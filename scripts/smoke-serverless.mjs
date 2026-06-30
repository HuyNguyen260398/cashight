#!/usr/bin/env node
/**
 * smoke-serverless.mjs
 *
 * Smoke tests for the serverless deployment at next.cashight.nghuy.link and
 * api.cashight.nghuy.link. All checks are unauthenticated or check that auth
 * is correctly enforced — no credentials are required.
 *
 * Required environment variables:
 *   APP_URL  — base URL of the frontend (e.g. https://next.cashight.nghuy.link)
 *   API_URL  — base URL of the API    (e.g. https://api.cashight.nghuy.link)
 *
 * Exit 0 = all checks passed
 * Exit 1 = one or more checks failed
 */

import https from 'node:https';
import http from 'node:http';

const APP_URL = (process.env.APP_URL ?? '').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? '').replace(/\/$/, '');

if (!APP_URL) throw new Error('APP_URL env var is required');
if (!API_URL) throw new Error('API_URL env var is required');

// ── HTTP client ───────────────────────────────────────────────────────────────

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
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

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.push({ name, passed: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${name}: ${msg}`);
    results.push({ name, passed: false, error: msg });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Smoke tests ───────────────────────────────────────────────────────────────

async function main() {
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
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${passed}/${results.length} checks passed`);

  if (failed > 0) {
    console.error(`${failed} check(s) failed — deployment is unhealthy`);
    process.exitCode = 1;
  } else {
    console.log('All smoke tests passed');
  }
}

main().catch((err) => {
  console.error(
    `Smoke test runner failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
