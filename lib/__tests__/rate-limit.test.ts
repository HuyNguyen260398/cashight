import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkRateLimit,
  resetRateLimitForTests,
} from '@/lib/security/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    resetRateLimitForTests();
    vi.useRealTimers();
  });

  it('allows requests before the limit is reached', () => {
    expect(checkRateLimit('user', { limit: 2, windowMs: 1000 })).toBeNull();
    expect(checkRateLimit('user', { limit: 2, windowMs: 1000 })).toBeNull();
  });

  it('returns 429 with Retry-After after the limit is reached', async () => {
    expect(checkRateLimit('user', { limit: 1, windowMs: 1000 })).toBeNull();

    const response = checkRateLimit('user', { limit: 1, windowMs: 1000 });

    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('1');
    await expect(response?.json()).resolves.toEqual({
      error: 'Too many requests',
    });
  });

  it('resets counters after the window expires', () => {
    expect(checkRateLimit('user', { limit: 1, windowMs: 1000 })).toBeNull();
    expect(checkRateLimit('user', { limit: 1, windowMs: 1000 })?.status).toBe(429);

    vi.setSystemTime(1001);

    expect(checkRateLimit('user', { limit: 1, windowMs: 1000 })).toBeNull();
  });
});
