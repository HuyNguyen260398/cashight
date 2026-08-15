import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Playwright uses an isolated build directory so its local server can run
  // alongside a developer's active `pnpm dev` process without sharing locks.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  // ── Static SPA export ──────────────────────────────────────────────────────
  // CloudFront/S3 serves the static output; there is no Next.js server process.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },

  // ── Common settings ────────────────────────────────────────────────────────
  poweredByHeader: false,
  transpilePackages: ['@cashight/domain'],

  // Response headers are owned by CloudFront in the static deployment.
  // (The former `headers()` function is removed.)

  experimental: {
    taint: true,
  },
};

export default nextConfig;
