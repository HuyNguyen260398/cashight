import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(path.resolve(__dirname, '../../Dockerfile'), 'utf8');

describe('Dockerfile', () => {
  it('every FROM is pinned by digest', () => {
    const froms = dockerfile.split('\n').filter((line) => line.startsWith('FROM '));
    expect(froms.length).toBeGreaterThan(0);
    for (const line of froms) {
      expect(line).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/);
    }
  });
});
