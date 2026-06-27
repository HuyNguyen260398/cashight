import type { NextConfig } from 'next';

const permissionsPolicy = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'magnetometer=()',
  'gyroscope=()',
  'accelerometer=()',
  'browsing-topics=()',
].join(', ');

const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com https://*.amazoncognito.com",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  // NOTE: 'upgrade-insecure-requests' is intentionally omitted — it is ignored
  // in a report-only policy (browsers warn about it). HTTPS is enforced in
  // production via Amplify Hosting + HSTS (customHttp.yml). If this CSP is ever
  // switched to the enforcing 'Content-Security-Policy' header, add it back there.
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@cashight/domain'],
  // pdf-parse / pdfjs-dist runtime packaging is environment-split on purpose:
  //
  //  - Production (`next build`, Amplify SSR): pdf-parse MUST stay bundled.
  //    Externalizing it breaks Amplify because the SSR runtime cannot resolve
  //    pdf-parse's transitive `pdfjs-dist` import from node_modules. Production
  //    instead relies on bundling + scripts/copy-pdf-worker.mjs, which ships the
  //    pdfjs worker to `.next/server/chunks/pdf.worker.mjs` so the fake worker
  //    resolves at runtime. See lib/__tests__/deployment-dependencies.test.ts.
  //
  //  - Development (`next dev`, Turbopack): the bundled fake worker tries to
  //    import `.next/dev/server/chunks/pdf.worker.mjs`, which Turbopack never
  //    emits (and copying it there does not help — Turbopack resolves the
  //    dynamic import through its module graph, not the filesystem). The upload
  //    then fails with "Setting up fake worker failed: Cannot find module
  //    .../pdf.worker.mjs". Externalizing ONLY in dev loads pdf-parse natively
  //    from node_modules, where the worker sits beside the package and resolves.
  //
  // The production artifact is therefore unchanged; this only affects dev.
  serverExternalPackages:
    process.env.NODE_ENV === 'development' ? ['pdf-parse'] : [],
  experimental: {
    taint: true,
  },
  async headers() {
    // Strict-Transport-Security is applied by Amplify Hosting in production
    // through customHttp.yml; local HTTP development must continue to work.
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: permissionsPolicy },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: cspReportOnly,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
