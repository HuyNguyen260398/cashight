// Post-build step: make pdf-parse's pdfjs worker resolvable in the bundled output.
//
// pdfjs (pdf-parse's engine) parses inside a worker; on the Node runtime it falls
// back to a "fake worker" that dynamically imports `./pdf.worker.mjs` resolved
// RELATIVE to the importing module. Once Next/Turbopack bundles pdf-parse into a
// route chunk, every importer lives in `.next/server/chunks/`, so the specifier
// resolves to `.next/server/chunks/pdf.worker.mjs` — a file the bundler never
// emits. At runtime that surfaces as:
//   "Setting up fake worker failed: Cannot find module .../chunks/pdf.worker.mjs"
// (the opaque upload 422 on Amplify). Turbopack also rewrites `require.resolve`,
// so a runtime `PDFParse.setWorker()` can't reach the real file either.
//
// Fix: copy the real worker file next to the chunks at build time. `.next/**` is
// exactly what Amplify ships, so the file is present at
// `/var/task/.next/server/chunks/pdf.worker.mjs` in production. The fake worker
// runs in-thread, so our globalThis DOM polyfills still apply to it.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// scripts/copy-pdf-worker.mjs -> project root (one dir up).
const root = fileURLToPath(new URL('..', import.meta.url));

// pdf.worker.mjs sits beside pdf-parse's package entry (not an exported subpath).
const workerSrc = join(dirname(require.resolve('pdf-parse')), 'pdf.worker.mjs');
if (!existsSync(workerSrc)) {
  console.error(`[copy-pdf-worker] worker not found at ${workerSrc}`);
  process.exit(1);
}

const chunksDir = join(root, '.next', 'server', 'chunks');
mkdirSync(chunksDir, { recursive: true });
const dest = join(chunksDir, 'pdf.worker.mjs');
copyFileSync(workerSrc, dest);
console.log(`[copy-pdf-worker] copied ${workerSrc} -> ${dest}`);
