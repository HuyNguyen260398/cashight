import { z } from 'zod';

// SEC-006: CORS is locked to exactly one allowed origin — keep in sync with
// x-amazon-apigateway-cors in terraform/api-openapi.yaml.tftpl. API Gateway
// only injects this header for MOCK integrations (OPTIONS preflight); Lambda
// proxy integrations must set it on every response themselves.
const ALLOWED_ORIGIN = 'https://cashight.nghuy.link';

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
