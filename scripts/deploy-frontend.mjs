#!/usr/bin/env node
/**
 * deploy-frontend.mjs
 *
 * Atomically deploys the Next.js static export from out/ to the frontend S3
 * bucket, then creates targeted CloudFront invalidations.
 *
 * Upload order guarantees atomic switch-over:
 *   1. _next/static/** (immutable, 1-year cache) — new JS/CSS chunks are live first
 *   2. Non-HTML root assets (favicon, robots.txt, etc.)
 *   3. Route HTML files (signin/index.html, upload/index.html, etc.)
 *   4. Root index.html — last, so the SPA shell update is the final write
 *
 * Required environment variables:
 *   FRONTEND_BUCKET          — S3 bucket name (from Terraform output)
 *   CLOUDFRONT_DISTRIBUTION_ID — CloudFront distribution ID
 *   AWS_REGION               — defaults to ap-southeast-1
 *
 * Optional:
 *   OUT_DIR                  — path to built output (default: out/)
 */

import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.OUT_DIR ?? path.join(ROOT, 'out');
const BUCKET = process.env.FRONTEND_BUCKET;
const DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID;
const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';

if (!BUCKET) throw new Error('FRONTEND_BUCKET env var is required');
if (!DISTRIBUTION_ID)
  throw new Error('CLOUDFRONT_DISTRIBUTION_ID env var is required');
if (!existsSync(OUT_DIR))
  throw new Error(`out/ directory not found at ${OUT_DIR} — run pnpm build first`);

const s3 = new S3Client({ region: REGION });
const cf = new CloudFrontClient({ region: REGION });

// ── MIME type lookup ──────────────────────────────────────────────────────────

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript'],
  ['.mjs', 'application/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.map', 'application/json'],
  ['.txt', 'text/plain'],
  ['.ico', 'image/x-icon'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.webmanifest', 'application/manifest+json'],
  ['.xml', 'application/xml'],
]);

function mimeType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

// ── Walk directory ────────────────────────────────────────────────────────────

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(abs, base)));
    } else {
      files.push(path.relative(base, abs));
    }
  }
  return files;
}

// ── Upload a single file ──────────────────────────────────────────────────────

async function upload(relPath, cacheControl) {
  const absPath = path.join(OUT_DIR, relPath);
  const key = relPath.replace(/\\/g, '/'); // normalise on Windows
  const contentType = mimeType(absPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: createReadStream(absPath),
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
  console.log(`  PUT s3://${BUCKET}/${key} [${cacheControl}]`);
}

// ── Classify files into upload batches ───────────────────────────────────────

async function classify(files) {
  const immutable = [];
  const nonHtmlRoot = [];
  const routeHtml = [];
  const rootIndex = [];

  for (const f of files) {
    const posixPath = f.replace(/\\/g, '/');
    if (posixPath.startsWith('_next/static/')) {
      immutable.push(f);
    } else if (posixPath === 'index.html') {
      rootIndex.push(f);
    } else if (path.extname(f).toLowerCase() === '.html') {
      routeHtml.push(f);
    } else {
      nonHtmlRoot.push(f);
    }
  }

  return { immutable, nonHtmlRoot, routeHtml, rootIndex };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Deploying frontend from ${OUT_DIR} to s3://${BUCKET}`);

  const allFiles = await walk(OUT_DIR);
  console.log(`Found ${allFiles.length} files`);

  const { immutable, nonHtmlRoot, routeHtml, rootIndex } =
    await classify(allFiles);

  // Batch 1: immutable static assets (JS/CSS chunks) — always safe to add first
  console.log(`\n[1/4] Uploading ${immutable.length} immutable static assets`);
  await Promise.all(
    immutable.map((f) =>
      upload(f, 'public, max-age=31536000, immutable'),
    ),
  );

  // Batch 2: non-HTML root assets (favicon, robots.txt, sitemap, etc.)
  console.log(`\n[2/4] Uploading ${nonHtmlRoot.length} non-HTML root assets`);
  for (const f of nonHtmlRoot) {
    await upload(f, 'public, max-age=60');
  }

  // Batch 3: route HTML (everything except index.html)
  console.log(`\n[3/4] Uploading ${routeHtml.length} route HTML files`);
  for (const f of routeHtml) {
    await upload(f, 'public, max-age=60');
  }

  // Batch 4: root index.html — last write, makes the new SPA shell live
  console.log(`\n[4/4] Uploading root index.html`);
  for (const f of rootIndex) {
    await upload(f, 'public, max-age=60');
  }

  // CloudFront invalidation — targeted paths only, not /*
  const invalidationPaths = [
    '/',
    '/index.html',
    '/signin/*',
    '/auth/*',
    '/upload/*',
    '/statements/*',
  ];

  console.log('\nCreating CloudFront invalidation...');
  const { Invalidation } = await cf.send(
    new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: randomUUID(),
        Paths: {
          Quantity: invalidationPaths.length,
          Items: invalidationPaths,
        },
      },
    }),
  );
  console.log(`Invalidation created: ${Invalidation.Id} (${Invalidation.Status})`);
  console.log('\nFrontend deployment complete.');
}

main().catch((err) => {
  console.error(
    `Deploy failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
