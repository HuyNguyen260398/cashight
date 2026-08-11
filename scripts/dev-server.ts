#!/usr/bin/env tsx
/**
 * Local-only API server: runs the production Lambda handlers in-process
 * against a JSON/file-backed store, so PDF statements can be uploaded and
 * parsed end to end without AWS.
 *
 * What it replaces:
 *   API Gateway  → the routing table below (same paths as api-openapi.yaml.tftpl)
 *   Cognito JWT  → a fixed claims object (DEV_SUB), see `buildEvent`
 *   S3           → scripts/local/object-store.ts (files under .local-data/objects)
 *   DynamoDB     → scripts/local/dynamo.ts (.local-data/table.json)
 *   S3→SQS→Lambda→ a background call to the real parser worker after PUT
 *   Secrets Mgr  → PDF_PASSWORD / GEMINI_API_KEY from .env.local
 *
 * Usage:
 *   pnpm dev:local          # this server on :8787
 *   pnpm dev                # the Next app on :3000, pointed at it
 *
 * .env.local needs:
 *   NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
 *   NEXT_PUBLIC_DEV_AUTH_BYPASS=true
 *
 * Never deployed. Nothing here is imported by the app or the Lambda bundles.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import type { ApiResponse } from '../backend/shared/api-response';
import {
  DEV_SUB,
  createLocalHandlers,
  processUploadedAwsInvoicePdf,
  processUploadedPdf,
  seedAuthorizedUser,
  seedSyntheticAwsInvoice,
} from './local/handlers';
import { parsePdfPasswords } from '../backend/shared/pdf-passwords';
import { UPLOAD_BUCKET, getObject, putObject } from './local/object-store';
import { localDataDir } from './local/paths';

// ── Configuration ─────────────────────────────────────────────────────────────

loadDotEnvLocal();

const PORT = Number(process.env.LOCAL_API_PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.LOCAL_ALLOWED_ORIGIN ?? 'http://localhost:3000';
const API_BASE_URL = process.env.LOCAL_API_BASE_URL ?? `http://localhost:${PORT}`;
/** Artificial lag before parsing, so the UI actually shows the PROCESSING state. */
const PARSE_DELAY_MS = Number(process.env.LOCAL_PARSE_DELAY_MS ?? 300);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Minimal .env.local reader. The Next dev server loads .env.local itself, but
 * this process is started separately by tsx and would otherwise miss
 * PDF_PASSWORD and GEMINI_API_KEY. Existing env vars always win.
 */
function loadDotEnvLocal(): void {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    const value = match[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

const handlers = createLocalHandlers({ apiBaseUrl: API_BASE_URL });

// ── Lambda event construction ─────────────────────────────────────────────────

/**
 * Build the API Gateway proxy event shape the handlers expect. The authorizer
 * claims are synthesized rather than validated: locally there is no Cognito,
 * and the point of this server is testing the parse pipeline, not the JWT
 * guard (which has its own suite in backend/__tests__/auth-guard.test.ts).
 */
function buildEvent(
  request: http.IncomingMessage,
  url: URL,
  pathParameters: Record<string, string>,
  body: string | null,
) {
  return {
    httpMethod: request.method ?? 'GET',
    path: url.pathname,
    pathParameters,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    headers: request.headers,
    body,
    requestContext: {
      requestId: crypto.randomUUID(),
      authorizer: {
        claims: {
          sub: DEV_SUB,
          token_use: 'access',
          scope: 'cashight/read cashight/write',
        },
      },
    },
  };
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
  };
}

/**
 * Send a handler's ApiResponse. The handlers hardcode the production
 * `Access-Control-Allow-Origin` (SEC-006 locks it to one origin); the local
 * origin is substituted here rather than loosening that production control.
 */
function sendApiResponse(response: http.ServerResponse, result: ApiResponse): void {
  response.writeHead(result.statusCode, {
    ...result.headers,
    ...corsHeaders(),
  });
  response.end(result.body);
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', ...corsHeaders() });
  response.end(JSON.stringify(body));
}

function readBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_UPLOAD_BYTES} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

// ── Upload → parse pipeline ───────────────────────────────────────────────────

/**
 * Stands in for the S3 ObjectCreated → SQS → parser Lambda chain. Runs in the
 * background so the PUT returns immediately and the client polls
 * GET /uploads/{jobId}, exactly as it does against the real API.
 */
function schedulePdfProcessing(key: string): void {
  setTimeout(() => {
    const invoiceMatch =
      /^uploads\/aws-invoices\/primary\/([0-9a-f-]{36})\.pdf$/i.exec(key);
    const statementUpload = key.startsWith('uploads/statements/primary/');
    const processing = invoiceMatch
      ? processUploadedAwsInvoicePdf(key, invoiceMatch[1])
      : statementUpload
        ? processUploadedPdf(key)
        : Promise.reject(new Error('Upload key does not match a parser prefix.'));
    void processing
      .then(() => console.log(`[parser] done: ${key}`))
      .catch((err: unknown) => {
        // Production would retry the SQS message and eventually DLQ it. Locally
        // there is no retry, so surface it loudly instead of hanging the poll.
        console.error(`[parser] FAILED: ${key}\n`, err);
      });
  }, PARSE_DELAY_MS);
}

// ── Router ────────────────────────────────────────────────────────────────────

async function route(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', API_BASE_URL);
  const segments = url.pathname.split('/').filter(Boolean);

  if (method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  // GET /health
  if (method === 'GET' && segments[0] === 'health') {
    sendJson(response, 200, { status: 'ok', mode: 'local', sub: DEV_SUB });
    return;
  }

  // PUT|GET /_local/objects/{bucket}/{key...} — the fake presigned endpoint
  if (segments[0] === '_local' && segments[1] === 'objects') {
    const bucket = segments[2];
    const key = segments.slice(3).map(decodeURIComponent).join('/');
    if (!bucket || !key) {
      sendJson(response, 400, { error: 'Expected /_local/objects/{bucket}/{key}' });
      return;
    }

    if (method === 'PUT') {
      if (bucket !== UPLOAD_BUCKET) {
        sendJson(response, 403, { error: `Uploads are only accepted into "${UPLOAD_BUCKET}"` });
        return;
      }
      await putObject(bucket, key, await readBody(request));
      console.log(`[upload] stored ${bucket}/${key}`);
      schedulePdfProcessing(key);
      response.writeHead(200, corsHeaders());
      response.end();
      return;
    }

    if (method === 'GET') {
      try {
        response.writeHead(200, corsHeaders());
        response.end(await getObject(bucket, key));
      } catch {
        sendJson(response, 404, { error: 'Not found' });
      }
      return;
    }
  }

  // POST /uploads
  if (method === 'POST' && segments[0] === 'uploads' && segments.length === 1) {
    const body = (await readBody(request)).toString('utf8');
    sendApiResponse(response, await handlers.uploads(buildEvent(request, url, {}, body)));
    return;
  }

  // GET /uploads/{jobId}
  if (method === 'GET' && segments[0] === 'uploads' && segments.length === 2) {
    const event = buildEvent(request, url, { jobId: decodeURIComponent(segments[1]) }, null);
    sendApiResponse(response, await handlers.uploadStatus(event));
    return;
  }

  // GET /statements and GET|DELETE /statements/{statementId}
  if (segments[0] === 'statements' && segments.length <= 2) {
    const pathParameters: Record<string, string> =
      segments.length === 2 ? { statementId: decodeURIComponent(segments[1]) } : {};
    if (method === 'GET' || (method === 'DELETE' && segments.length === 2)) {
      const event = buildEvent(request, url, pathParameters, null);
      sendApiResponse(response, await handlers.statements(event));
      return;
    }
  }

  // GET /dashboard
  if (method === 'GET' && segments[0] === 'dashboard' && segments.length === 1) {
    sendApiResponse(response, await handlers.dashboard(buildEvent(request, url, {}, null)));
    return;
  }

  // GET /session/capabilities
  if (
    method === 'GET' &&
    segments[0] === 'session' &&
    segments[1] === 'capabilities' &&
    segments.length === 2
  ) {
    sendApiResponse(
      response,
      await handlers.sessionCapabilities(buildEvent(request, url, {}, null)),
    );
    return;
  }

  // Cost Explorer handler owns exact method/subpath dispatch and validation.
  if (
    segments[0] === 'aws' &&
    segments[1] === 'cost-explorer' &&
    segments.length >= 3
  ) {
    const body = method === 'POST' ? (await readBody(request)).toString('utf8') : null;
    const pathParameters: Record<string, string> =
      segments[2] === 'reports' && segments[3]
        ? { reportId: decodeURIComponent(segments[3]) }
        : {};
    sendApiResponse(
      response,
      await handlers.costExplorer(buildEvent(request, url, pathParameters, body)),
    );
    return;
  }

  // AWS invoice handler owns upload/status/list/detail/delete/dashboard routes.
  if (
    segments[0] === 'aws' &&
    segments[1] === 'invoices' &&
    segments.length >= 2
  ) {
    const body = method === 'POST' ? (await readBody(request)).toString('utf8') : null;
    const pathParameters: Record<string, string> = {};
    if (segments[2] === 'uploads' && segments[3]) {
      pathParameters.jobId = decodeURIComponent(segments[3]);
    } else if (segments[2] && !['uploads', 'dashboard'].includes(segments[2])) {
      pathParameters.yearMonth = decodeURIComponent(segments[2]);
    }
    sendApiResponse(
      response,
      await handlers.awsInvoices(buildEvent(request, url, pathParameters, body)),
    );
    return;
  }

  // POST /summaries
  if (method === 'POST' && segments[0] === 'summaries' && segments.length === 1) {
    const body = (await readBody(request)).toString('utf8');
    sendApiResponse(response, await handlers.summaries(buildEvent(request, url, {}, body)));
    return;
  }

  sendJson(response, 404, {
    error: { code: 'NOT_FOUND', message: `No local route for ${method} ${url.pathname}` },
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const server = http.createServer((request, response) => {
  const started = Date.now();
  response.on('finish', () => {
    console.log(
      `${request.method} ${request.url} → ${response.statusCode} (${Date.now() - started}ms)`,
    );
  });
  void route(request, response).catch((err: unknown) => {
    console.error('[dev-server] unhandled error:', err);
    if (!response.headersSent) sendJson(response, 500, { error: String(err) });
    else response.end();
  });
});

/**
 * Describe the configured PDF passwords WITHOUT revealing any of them.
 *
 * Reports the candidate count rather than a boolean: with two supported banks,
 * "set" was misleading — a single TPBank password reads as configured while
 * every VIB upload fails with WRONG_PASSWORD.
 */
function describePdfPasswords(): string {
  const secret = process.env.PDF_PASSWORDS ?? process.env.PDF_PASSWORD ?? '';
  const count = parsePdfPasswords(secret).length;
  if (count === 0) return 'none set (protected PDFs will fail)';
  const source = process.env.PDF_PASSWORDS ? 'PDF_PASSWORDS' : 'PDF_PASSWORD';
  return `${count} candidate${count === 1 ? '' : 's'} from ${source}`;
}

async function main(): Promise<void> {
  await seedAuthorizedUser();
  await seedSyntheticAwsInvoice();
  server.listen(PORT, () => {
    console.log(
      [
        '',
        `  cashight local API  →  ${API_BASE_URL}`,
        `  data directory      →  ${localDataDir()}`,
        `  acting as sub       →  ${DEV_SUB}`,
        `  CORS origin         →  ${ALLOWED_ORIGIN}`,
        `  PDF passwords       →  ${describePdfPasswords()}`,
        `  Gemini              →  ${process.env.GEMINI_API_KEY ? 'real API' : 'stubbed'}`,
        '',
        '  Point the app at it with, in .env.local:',
        `    NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL}`,
        '    NEXT_PUBLIC_DEV_AUTH_BYPASS=true',
        '',
      ].join('\n'),
    );
  });
}

void main();
