const SECRET_KEYS = new Set([
  'PDF_PASSWORD',
  'GEMINI_API_KEY',
  'AUTH_SECRET',
  'AUTH_GOOGLE_SECRET',
  'AUTH_COGNITO_SECRET',
]);

const SENSITIVE_DATA_KEYS = new Set(['TRANSACTIONS']);

const PAN_SEQUENCE_RE = /\b\d{13,19}\b/g;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function redactForLog(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(PAN_SEQUENCE_RE, '[REDACTED_PAN]');
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactForLog(value.message),
      stack: redactForLog(value.stack),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item));
  }

  if (!isPlainObject(value)) {
    return redactForLog(String(value));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toUpperCase();
    if (SECRET_KEYS.has(normalizedKey) || SENSITIVE_DATA_KEYS.has(normalizedKey)) {
      continue;
    }
    redacted[key] = redactForLog(item);
  }
  return redacted;
}
