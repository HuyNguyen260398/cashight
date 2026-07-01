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
  };
}

export interface ApiResponse {
  statusCode: number;
  headers: {
    'content-type': 'application/json';
    'Access-Control-Allow-Origin': string;
  };
  body: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
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
    error: { code, message, requestId },
  };
  return jsonResponse(statusCode, body);
}
