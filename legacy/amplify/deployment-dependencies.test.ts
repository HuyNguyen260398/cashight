import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '@/next.config';
import packageJson from '@/package.json';

describe('deployment dependencies', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('declares pdfjs-dist directly so parser packaging remains explicit', () => {
    expect(packageJson.dependencies).toHaveProperty('pdfjs-dist');
  });

  it('does not externalize pdf-parse in production because Amplify SSR cannot resolve its pdfjs-dist import', () => {
    // The top-level import evaluates under vitest's NODE_ENV ('test'), i.e. the
    // non-development branch — the same config the production build emits.
    expect(nextConfig.serverExternalPackages ?? []).not.toContain('pdf-parse');
  });

  it('externalizes pdf-parse in development so Turbopack dev can resolve the pdfjs worker', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const devConfig = (await import('@/next.config')).default;
    expect(devConfig.serverExternalPackages ?? []).toContain('pdf-parse');
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
