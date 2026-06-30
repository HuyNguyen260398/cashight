import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
