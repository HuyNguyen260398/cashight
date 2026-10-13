export interface RateLimiter {
  /** Take one token. False means the caller should be refused. */
  take(): boolean;
}

export function createRateLimiter(options: {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}): RateLimiter {
  const { capacity, refillPerSecond, now = Date.now } = options;
  if (!(capacity > 0) || !(refillPerSecond > 0)) {
    throw new RangeError('Rate limiter capacity and refillPerSecond must be positive.');
  }

  let tokens = capacity;
  let last = now();

  return {
    take(): boolean {
      const current = now();
      const elapsedSeconds = Math.max(0, current - last) / 1000;
      last = current;
      tokens = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
