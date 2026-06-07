interface Bucket {
  count: number;
  expiresAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): Response | null {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + options.windowMs });
    return null;
  }

  if (existing.count >= options.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.expiresAt - now) / 1000),
    );
    return Response.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      },
    );
  }

  existing.count += 1;
  return null;
}
