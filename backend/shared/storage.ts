import { StatementSchema, type Statement } from '@cashight/domain/schemas';
import { z } from 'zod';

import { ApiError } from './api-response';

const subjectSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const cardLast4Schema = z.string().regex(/^\d{4}$/);
const yearSchema = z.number().int().min(1900).max(9999);
const monthSchema = z.number().int().min(1).max(12);

function validateStatementCoordinates(
  cardLast4: string,
  year: number,
  month: number,
): void {
  if (!cardLast4Schema.safeParse(cardLast4).success) {
    throw new ApiError('INVALID_REQUEST', 400, 'Invalid card suffix.');
  }
  if (!yearSchema.safeParse(year).success) {
    throw new ApiError('INVALID_REQUEST', 400, 'Invalid year.');
  }
  if (!monthSchema.safeParse(month).success) {
    throw new ApiError('INVALID_REQUEST', 400, 'Invalid month.');
  }
}

export function statementId(
  cardLast4: string,
  year: number,
  month: number,
): string {
  validateStatementCoordinates(cardLast4, year, month);
  const mm = String(month).padStart(2, '0');
  return `${year}-${mm}-${cardLast4}`;
}

export function statementObjectKey(
  sub: string,
  cardLast4: string,
  year: number,
  month: number,
): string {
  if (!subjectSchema.safeParse(sub).success) {
    throw new ApiError('INVALID_REQUEST', 400, 'Invalid subject');
  }
  validateStatementCoordinates(cardLast4, year, month);
  const mm = String(month).padStart(2, '0');
  return `users/${sub}/statements/${cardLast4}/${year}/${year}-${mm}.json`;
}

export function parseStatementObject(body: string | Uint8Array): Statement {
  try {
    const text =
      typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
    return StatementSchema.parse(JSON.parse(text));
  } catch {
    throw new ApiError(
      'DATA_INTEGRITY_ERROR',
      500,
      'Invalid statement object',
    );
  }
}
