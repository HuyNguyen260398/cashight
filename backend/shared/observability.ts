import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { redactForLog } from '@cashight/domain/security/logging';

const SENSITIVE_LOG_KEYS = new Set([
  'authorization',
  'body',
  'description',
  'email',
  'name',
  'password',
  'pdf',
  'secret',
  'token',
  'transactions',
  'username',
]);

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return (
    SENSITIVE_LOG_KEYS.has(normalized) ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('email') ||
    normalized.includes('description')
  );
}

export const logger = new Logger({ serviceName: 'cashight' });
export const metrics = new Metrics({
  namespace: 'Cashight',
  serviceName: 'cashight',
});
export const tracer = new Tracer({ serviceName: 'cashight' });

export function sanitizeForLog(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name };
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (typeof value !== 'object' || value === null) return redactForLog(value);

  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveLogKey(key)) continue;
    safe[key] = sanitizeForLog(item);
  }
  return safe;
}
