import { z } from 'zod';

// SEC-006: CORS is locked to exactly one allowed origin per deployment. The
// default is the production hostname and must stay in sync with
// x-amazon-apigateway-cors in terraform/api-openapi.yaml.tftpl. API Gateway
// only injects this header for MOCK integrations (OPTIONS preflight); Lambda
// proxy integrations must set it on every response themselves. The Lambdas
// never set ALLOWED_ORIGIN, so they always use the default. A container
// deployment sets it to the hostname its own frontend is served from.
const DEFAULT_ALLOWED_ORIGIN = 'https://cashight.nghuy.link';

function isSingleHttpsOrigin(value: string): boolean {
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(value)) return false;
  try {
    // Also rejects a default port and anything else a browser would not send.
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/**
 * The one origin allowed to call this deployment. A value that is not a single
 * https origin throws, so a typo stops the process instead of silently
 * breaking or widening CORS.
 */
export function allowedOriginFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env.ALLOWED_ORIGIN?.trim();
  if (!value) return DEFAULT_ALLOWED_ORIGIN;
  if (!isSingleHttpsOrigin(value)) throw new Error('Invalid configuration: ALLOWED_ORIGIN');
  return value;
}

export const ALLOWED_ORIGIN = allowedOriginFromEnv();

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable?: true;
  };
}

export interface ApiResponse {
  statusCode: number;
  headers: {
    'content-type': 'application/json' | 'text/plain; charset=utf-8';
    'Access-Control-Allow-Origin': string;
  };
  body: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonResponse(statusCode: number, body: unknown): ApiResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    },
    body: JSON.stringify(body),
  };
}

// API Gateway's aws_proxy integration only supports buffered responses — a
// Lambda invoked through it cannot use awslambda.streamifyResponse (that's a
// Function URL-only invoke mode). This returns a single complete text body.
export function textResponse(statusCode: number, body: string): ApiResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    },
    body,
  };
}

export function errorResponse(error: unknown, requestId: string): ApiResponse {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred.';

  if (error instanceof z.ZodError) {
    statusCode = 400;
    code = 'INVALID_REQUEST';
    message = 'The request is invalid.';
  } else if (error instanceof ApiError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
  }

  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId,
      ...(error instanceof ApiError && error.retryable
        ? { retryable: true as const }
        : {}),
    },
  };
  return jsonResponse(statusCode, body);
}
