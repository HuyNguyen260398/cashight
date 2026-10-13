/**
 * HTTP front end for the API handlers when they run in a container.
 *
 * It does what API Gateway did around each Lambda: CORS preflight, throttling,
 * token verification, routing, and building the proxy event. Handlers are the
 * same functions the Lambdas export and are not aware of the difference.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';

import { SpanStatusCode, metrics as otelMetrics, trace } from '@opentelemetry/api';

import {
  ALLOWED_ORIGIN,
  ApiError,
  errorResponse,
  type ApiResponse,
} from '../shared/api-response';
import { logger } from '../shared/observability';
import {
  AuthError,
  bearerToken,
  type AccessTokenVerifier,
  type AuthorizerClaims,
} from './jwt';
import type { RateLimiter } from './rate-limit';
import { matchRoute, type HandlerName } from './routes';

export type ApiHandler = (event: unknown) => Promise<ApiResponse>;

export interface ApiServerOptions {
  /** Only the handlers this service owns; other routes answer 404. */
  handlers: Partial<Record<HandlerName, ApiHandler>>;
  verifier: AccessTokenVerifier;
  rateLimiter: RateLimiter;
  isReady?: () => boolean;
  maxBodyBytes?: number;
}

// Methods, headers and max-age mirror x-amazon-apigateway-cors in
// terraform/api-openapi.yaml.tftpl; keep them in sync until API Gateway is
// removed. The origin is this deployment's single allowed origin (SEC-006).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token',
  'Access-Control-Max-Age': '300',
} as const;

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {}

interface Outcome {
  status: number;
  route: string;
}

function readBody(request: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Stop buffering but keep draining so the 413 can be delivered.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) reject(new PayloadTooLargeError());
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function write(
  response: http.ServerResponse,
  result: ApiResponse,
  extraHeaders: Record<string, string> = {},
): number {
  response.writeHead(result.statusCode, { ...result.headers, ...extraHeaders });
  response.end(result.body);
  return result.statusCode;
}

function writeError(
  response: http.ServerResponse,
  requestId: string,
  error: ApiError,
  extraHeaders: Record<string, string> = {},
): number {
  return write(response, errorResponse(error, requestId), extraHeaders);
}

export function createApiServer(options: ApiServerOptions): http.Server {
  const {
    handlers,
    verifier,
    rateLimiter,
    isReady = () => true,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  } = options;

  // Created here, not at module scope: instruments made before telemetry
  // starts are permanently no-ops.
  const duration = otelMetrics
    .getMeter('cashight')
    .createHistogram('http.server.request.duration', { unit: 's' });
  const tracer = trace.getTracer('cashight');

  async function dispatch(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    requestId: string,
    onRoute: (name: string) => void,
  ): Promise<Outcome> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://internal');

    if (method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return { status: 204, route: 'preflight' };
    }

    if (method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      });
      response.end('{"status":"ok"}');
      return { status: 200, route: 'health' };
    }

    if (!rateLimiter.take()) {
      const status = writeError(
        response,
        requestId,
        new ApiError('TOO_MANY_REQUESTS', 429, 'Too many requests.', true),
        { 'Retry-After': '1' },
      );
      return { status, route: 'throttled' };
    }

    const match = matchRoute(method, url.pathname);
    const handler = match ? handlers[match.handler] : undefined;
    if (!match || !handler) {
      const status = writeError(
        response,
        requestId,
        new ApiError('NOT_FOUND', 404, 'No such route.'),
      );
      return { status, route: 'unmatched' };
    }
    const route = match.handler;
    // Reported before the handler runs so a thrown error is still attributed.
    onRoute(route);

    let claims: AuthorizerClaims;
    try {
      const token = bearerToken(request.headers.authorization);
      if (!token) throw new AuthError('Missing bearer token.');
      claims = await verifier.verify(token);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      const status = writeError(
        response,
        requestId,
        new ApiError('UNAUTHORIZED', 401, 'Authentication is required.'),
      );
      return { status, route };
    }

    let body: string | null = null;
    if (match.readsBody) {
      try {
        body = await readBody(request, maxBodyBytes);
      } catch (error) {
        if (!(error instanceof PayloadTooLargeError)) throw error;
        const status = writeError(
          response,
          requestId,
          new ApiError('PAYLOAD_TOO_LARGE', 413, 'The request body is too large.'),
          { Connection: 'close' },
        );
        return { status, route };
      }
    }

    const result = await handler({
      httpMethod: method,
      path: url.pathname,
      pathParameters: match.pathParameters,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      headers: request.headers,
      body,
      requestContext: { requestId, authorizer: { claims } },
    });
    return { status: write(response, result), route };
  }

  const server = http.createServer((request, response) => {
    const method = request.method ?? 'GET';
    const pathname = (request.url ?? '/').split('?')[0];

    // Probes stay out of traces, metrics and logs.
    if (method === 'GET' && pathname === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ok"}');
      return;
    }
    if (method === 'GET' && pathname === '/readyz') {
      const ready = isReady();
      response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(ready ? '{"status":"ready"}' : '{"status":"draining"}');
      return;
    }

    const requestId = randomUUID();
    const started = process.hrtime.bigint();

    void tracer.startActiveSpan('http.request', async (span) => {
      let outcome: Outcome = { status: 500, route: 'unmatched' };
      try {
        outcome = await dispatch(request, response, requestId, (name) => {
          outcome = { status: 500, route: name };
        });
      } catch (error) {
        // Name only: messages and stacks can carry statement data.
        const errorName = error instanceof Error ? error.name : 'unknown';
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorName });
        logger.error('unhandled request error', { requestId, errorName });
        if (!response.headersSent) {
          writeError(response, requestId, new ApiError('INTERNAL_ERROR', 500, 'An unexpected error occurred.'));
        } else {
          response.end();
        }
      } finally {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        const attributes = {
          'http.request.method': method,
          'http.route': outcome.route,
          'http.response.status_code': outcome.status,
        };
        span.updateName(`${method} ${outcome.route}`);
        span.setAttributes(attributes);
        if (outcome.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        duration.record(seconds, attributes);
        logger.info('request', {
          requestId,
          method,
          route: outcome.route,
          status: outcome.status,
          durationMs: Math.round(seconds * 1000),
        });
      }
    });
  });

  // An ALB keeps idle connections for 60 s. Node must outlast it, or the ALB
  // reuses a socket Node has just closed and returns a 502.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  return server;
}
