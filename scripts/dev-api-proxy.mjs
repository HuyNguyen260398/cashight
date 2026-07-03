#!/usr/bin/env node
// Local-only CORS proxy for testing the SPA against the deployed prod API
// from http://localhost:3000.
//
// The prod API (SEC-006) returns `Access-Control-Allow-Origin:
// https://cashight.nghuy.link` unconditionally on every response, including
// preflight — deliberately locked to one origin. Rather than loosen that
// production security control just for local testing, this proxy sits
// between the local browser and the real prod API and rewrites that one
// header for the local origin. Nothing on AWS changes.
//
// Usage: node scripts/dev-api-proxy.mjs
// Then point NEXT_PUBLIC_API_BASE_URL at http://localhost:8787 in .env.local.
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const TARGET = new URL(process.env.API_PROXY_TARGET ?? 'https://api.cashight.nghuy.link');
const PORT = Number(process.env.API_PROXY_PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.API_PROXY_ALLOWED_ORIGIN ?? 'http://localhost:3000';

const HOP_BY_HOP = new Set([
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function stripHopByHop(headers) {
  const out = { ...headers };
  for (const h of HOP_BY_HOP) delete out[h];
  return out;
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && origin !== ALLOWED_ORIGIN) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end(`dev-api-proxy only accepts requests from ${ALLOWED_ORIGIN}, got ${origin}`);
    return;
  }

  const headers = stripHopByHop(req.headers);
  headers.host = TARGET.host;

  const upstreamReq = https.request(
    {
      protocol: TARGET.protocol,
      hostname: TARGET.hostname,
      port: TARGET.port || 443,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      const outHeaders = stripHopByHop(upstreamRes.headers);
      // The only rewrite: swap the prod-locked origin for the local one so
      // the browser's CORS check passes. Every other header (including
      // Access-Control-Allow-Methods/Headers) comes straight from the API.
      outHeaders['access-control-allow-origin'] = ALLOWED_ORIGIN;

      res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on('error', (err) => {
    console.error('[dev-api-proxy] upstream error:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Bad gateway: dev proxy could not reach the API');
  });

  req.pipe(upstreamReq);
});

server.listen(PORT, () => {
  console.log(
    `[dev-api-proxy] http://localhost:${PORT} -> ${TARGET.origin}  (allowed browser origin: ${ALLOWED_ORIGIN})`,
  );
});
