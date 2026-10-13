import { metrics as otelMetrics, trace, type Counter } from '@opentelemetry/api';
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

const SERVICE = 'cashight';

// ── Metrics ───────────────────────────────────────────────────────────────────

export const MetricUnit = { Count: 'Count' } as const;
export type MetricUnitName = (typeof MetricUnit)[keyof typeof MetricUnit];

/** `LegacyWorkspaceFallback` → `cashight.legacy_workspace_fallback`. */
export function metricInstrumentName(name: string): string {
  return `${SERVICE}.${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;
}

const counters = new Map<string, Counter>();

export const metrics = {
  /**
   * Count an occurrence. Exported through OpenTelemetry when the container
   * runtime has started telemetry; a no-op everywhere else, including Lambda.
   * Attribute values must be low-cardinality and free of personal data.
   */
  addMetric(
    name: string,
    _unit: MetricUnitName,
    value: number,
    attributes?: Record<string, string>,
  ): void {
    let counter = counters.get(name);
    if (!counter) {
      counter = otelMetrics.getMeter(SERVICE).createCounter(metricInstrumentName(name));
      counters.set(name, counter);
    }
    counter.add(value, attributes);
  },
};

// ── Logging ───────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error';

function writeLog(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const spanContext = trace.getActiveSpan()?.spanContext();
  const line = {
    ...(sanitizeForLog(fields) as Record<string, unknown>),
    ...(spanContext ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : {}),
    timestamp: new Date().toISOString(),
    service: SERVICE,
    level,
    message,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** Structured JSON logger. Every field passes through `sanitizeForLog`. */
export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => writeLog('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => writeLog('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => writeLog('error', message, fields),
};
