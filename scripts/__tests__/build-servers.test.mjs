import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildServers } from '../build-servers.mjs';

describe('buildServers', () => {
  it('bundles the four entrypoints and ships the pdf worker with both workers', async () => {
    const { serverNames, outputRoot } = await buildServers();

    expect(serverNames).toEqual(['api', 'aws-api', 'invoice-parser-worker', 'parser-worker']);
    for (const name of serverNames) {
      const bundle = path.join(outputRoot, name, 'index.js');
      expect(existsSync(bundle), bundle).toBe(true);
      expect(statSync(bundle).size).toBeGreaterThan(10_000);
    }
    for (const name of ['parser-worker', 'invoice-parser-worker']) {
      expect(existsSync(path.join(outputRoot, name, 'pdf.worker.mjs'))).toBe(true);
    }
    for (const name of ['api', 'aws-api']) {
      expect(existsSync(path.join(outputRoot, name, 'pdf.worker.mjs'))).toBe(false);
    }
  }, 120_000);
});
