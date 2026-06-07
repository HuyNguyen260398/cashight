import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import nextConfig from '@/next.config';
import packageJson from '@/package.json';

describe('deployment dependencies', () => {
  it('declares pdfjs-dist directly so parser packaging remains explicit', () => {
    expect(packageJson.dependencies).toHaveProperty('pdfjs-dist');
  });

  it('does not externalize pdf-parse because Amplify SSR cannot resolve its pdfjs-dist import', () => {
    expect(nextConfig.serverExternalPackages ?? []).not.toContain('pdf-parse');
  });

  // When Turbopack bundles pdf-parse into a route chunk, pdfjs's fake worker tries
  // to import `./pdf.worker.mjs` from `.next/server/chunks/`, which the bundler
  // never emits — the Amplify upload 422. scripts/copy-pdf-worker.mjs copies the
  // real worker there post-build; these guard that contract.
  it('runs the worker-copy step after next build', () => {
    expect(packageJson.scripts.build).toContain('scripts/copy-pdf-worker.mjs');
  });

  it("can resolve pdf-parse's bundled pdf.worker.mjs (the file the copy step ships)", () => {
    const require = createRequire(import.meta.url);
    const worker = join(dirname(require.resolve('pdf-parse')), 'pdf.worker.mjs');
    expect(existsSync(worker)).toBe(true);
  });
});
