#!/usr/bin/env node
/**
 * verify-static-export.mjs
 *
 * Verifies that a `next build` with `output: 'export'` produced the expected
 * static HTML files and did NOT leave behind server-side route-handler
 * artifacts in `.next/server/app/api/`.
 *
 * Exit 0  → everything looks correct
 * Exit 1  → one or more checks failed (messages printed to stderr)
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;

// ── 1. Required static HTML pages ────────────────────────────────────────────

const requiredPages = [
  'out/index.html',
  'out/signin/index.html',
  'out/auth/callback/index.html',
  'out/upload/index.html',
  'out/statements/index.html',
];

let failed = false;

for (const page of requiredPages) {
  const abs = join(ROOT, page);
  if (!existsSync(abs)) {
    console.error(`[verify:static] MISSING: ${page}`);
    failed = true;
  } else {
    console.log(`[verify:static] OK:      ${page}`);
  }
}

// ── 2. No server route-handler artifacts ─────────────────────────────────────
//
// A successful export build with `output: 'export'` must NOT produce server
// route-handler bundles in `.next/server/app/api/`.  Their presence indicates
// that a server-side API route was not removed before the build.

const serverApiDir = join(ROOT, '.next', 'server', 'app', 'api');

if (existsSync(serverApiDir)) {
  // Walk the directory for any `route.js` files.
  function findRouteFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...findRouteFiles(abs));
      } else if (entry.name === 'route.js') {
        found.push(abs);
      }
    }
    return found;
  }

  const routeFiles = findRouteFiles(serverApiDir);
  if (routeFiles.length > 0) {
    for (const f of routeFiles) {
      console.error(`[verify:static] UNEXPECTED server route artifact: ${f}`);
    }
    failed = true;
  } else {
    console.log('[verify:static] OK:      no route.js artifacts in .next/server/app/api/');
  }
} else {
  console.log('[verify:static] OK:      .next/server/app/api/ does not exist (expected for static export)');
}

// ── Result ────────────────────────────────────────────────────────────────────

if (failed) {
  console.error('\n[verify:static] FAILED — see messages above.');
  process.exit(1);
} else {
  console.log('\n[verify:static] PASSED — static export looks correct.');
  process.exit(0);
}
