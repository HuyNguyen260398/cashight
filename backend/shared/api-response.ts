import { z } from 'zod';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export interface ApiResponse {
  statusCode: number;
  headers: { 'content-type': 'application/json' };
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
    headers: { 'content-type': 'application/json' },
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
