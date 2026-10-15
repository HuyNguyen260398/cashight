import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../server/rate-limit';

describe('createRateLimiter', () => {
  it('allows a burst up to capacity, then refuses', () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => 0 });
    expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('refills over time', () => {
    let clock = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 2, now: () => clock });
    limiter.take();
    limiter.take();
    expect(limiter.take()).toBe(false);
    clock = 500;
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
  });

  it('never exceeds capacity after a long idle period', () => {
    let clock = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 10, now: () => clock });
    clock = 60_000;
    expect([limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, false]);
  });

  it('tolerates a clock that moves backwards', () => {
    let clock = 1_000;
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => clock });
    limiter.take();
    clock = 0;
    expect(limiter.take()).toBe(false);
  });

  it.each([
    [0, 1],
    [1, 0],
    [-1, 1],
    [Number.NaN, 1],
  ])('rejects capacity=%s refill=%s', (capacity, refillPerSecond) => {
    expect(() => createRateLimiter({ capacity, refillPerSecond })).toThrow(RangeError);
  });
});
