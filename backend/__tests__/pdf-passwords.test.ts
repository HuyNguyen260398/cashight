import { describe, expect, it } from 'vitest';

import { parsePdfPasswords } from '../shared/pdf-passwords';

describe('parsePdfPasswords', () => {
  it('returns an empty list for an empty secret', () => {
    expect(parsePdfPasswords('')).toEqual([]);
    expect(parsePdfPasswords('   ')).toEqual([]);
  });

  it('treats a plain string as a single password (legacy secret shape)', () => {
    expect(parsePdfPasswords('hunter2')).toEqual(['hunter2']);
  });

  it('returns the values of a JSON map in declaration order', () => {
    expect(parsePdfPasswords('{"TPB":"aaa","VIB":"bbb"}')).toEqual(['aaa', 'bbb']);
  });

  it('drops empty and non-string values from the map', () => {
    expect(parsePdfPasswords('{"TPB":"aaa","VIB":"","X":3}')).toEqual(['aaa']);
  });

  it('falls back to treating malformed JSON as a single password', () => {
    expect(parsePdfPasswords('{not json')).toEqual(['{not json']);
  });

  it('deduplicates repeated passwords', () => {
    expect(parsePdfPasswords('{"A":"same","B":"same"}')).toEqual(['same']);
  });
});
