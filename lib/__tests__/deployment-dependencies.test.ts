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
});
