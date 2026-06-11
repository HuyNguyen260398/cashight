import { describe, expect, it } from 'vitest';
import { getRevealDelayStyle } from '@/lib/reveal';

describe('getRevealDelayStyle', () => {
  it('returns a staggered transition delay in milliseconds', () => {
    expect(getRevealDelayStyle(3)).toEqual({ transitionDelay: '210ms' });
  });

  it('does not return a negative transition delay', () => {
    expect(getRevealDelayStyle(-1)).toEqual({ transitionDelay: '0ms' });
  });
});
