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
  VerifierUnavailableError,
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

/** The client sent something unusable or went away; not a server fault. */
class BadRequestError extends Error {}

interface Outcome {
  status: number;
  route: string;
}

function readBody(request: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = request.headers['content-length'];
    if (declared !== undefined && Number(declared) > maxBytes) {
      reject(new PayloadTooLargeError());
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('close', onClose);
      action();
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > maxBytes) {
        // Reject now; waiting for `end` would let a client hold the connection.
        chunks.length = 0;
        request.pause();
        finish(() => reject(new PayloadTooLargeError()));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => finish(() => resolve(Buffer.concat(chunks).toString('utf8')));
    const onError = (): void => finish(() => reject(new BadRequestError()));
    // A client that aborts mid-body closes the request without `end`.
    const onClose = (): void => finish(() => reject(new BadRequestError()));
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('close', onClose);
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
    .createHistogram('http.server.request.duration', {
      unit: 's',
      advice: {
        explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
      },
    });
  const tracer = trace.getTracer('cashight');

  async function dispatch(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    requestId: string,
    onRoute: (name: string) => void,
  ): Promise<Outcome> {
    const method = request.method ?? 'GET';
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://internal');
    } catch {
      // e.g. a request target of `//`.
      const status = writeError(
        response,
        requestId,
        new ApiError('BAD_REQUEST', 400, 'The request target is invalid.'),
      );
      return { status, route: 'unmatched' };
    }

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
      if (error instanceof VerifierUnavailableError) {
        // An outage on our side must not look like a bad credential (401 signs
        // the user out). Name only: never the token or the message.
        logger.warn('token verifier unavailable', {
          requestId,
          route,
          errorName: error.name,
        });
        const status = writeError(
          response,
          requestId,
          new ApiError('SERVICE_UNAVAILABLE', 503, 'The service is temporarily unavailable.', true),
          { 'Retry-After': '5' },
        );
        return { status, route };
      }
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
        if (error instanceof BadRequestError) {
          // The client went away mid-body; there may be nobody to answer.
          if (response.writableEnded || response.destroyed || !response.socket?.writable) {
            return { status: 400, route };
          }
          const status = writeError(
            response,
            requestId,
            new ApiError('BAD_REQUEST', 400, 'The request could not be read.'),
            { Connection: 'close' },
          );
          return { status, route };
        }
        if (!(error instanceof PayloadTooLargeError)) throw error;
        // Once the 413 is flushed, drop the connection: the rest of the body
        // is unwanted and a client must not be able to keep the socket open.
        response.once('finish', () => request.destroy());
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
