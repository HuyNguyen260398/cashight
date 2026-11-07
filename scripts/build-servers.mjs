import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, '..');

/** Container entrypoints. The two workers load pdfjs and need its worker file. */
const SERVERS = [
  { name: 'api', needsPdfWorker: false },
  { name: 'aws-api', needsPdfWorker: false },
  { name: 'invoice-parser-worker', needsPdfWorker: true },
  { name: 'parser-worker', needsPdfWorker: true },
];

export async function buildServers({ projectRoot = defaultProjectRoot } = {}) {
  const outputRoot = path.join(projectRoot, 'dist/servers');
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const { name, needsPdfWorker } of SERVERS) {
    const outputDirectory = path.join(outputRoot, name);
    await mkdir(outputDirectory, { recursive: true });

    if (needsPdfWorker) {
      const workerSource = path.join(
        projectRoot,
        'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      );
      try {
        await copyFile(workerSource, path.join(outputDirectory, 'pdf.worker.mjs'));
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          throw new Error(`pdf.worker.mjs is required for ${name}: ${workerSource}`);
        }
        throw error;
      }
    }

    const bundles = [{ entry: name, outfile: 'index.js' }];
    // CI's in-image PDF smoke test sits next to the parser's pdf.worker.mjs.
    if (name === 'parser-worker') bundles.push({ entry: 'pdf-smoke', outfile: 'pdf-smoke.js' });

    for (const { entry, outfile } of bundles) {
      await build({
        absWorkingDir: projectRoot,
        entryPoints: [`backend/server/entrypoints/${entry}.ts`],
        outfile: path.join(outputDirectory, outfile),
        bundle: true,
        format: 'cjs',
        logLevel: 'silent',
        platform: 'node',
        sourcemap: 'external',
        target: 'node22',
      });
    }
  }

  return { serverNames: SERVERS.map(({ name }) => name), outputRoot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildServers()
    .then(({ serverNames, outputRoot }) => {
      console.log(`Built ${serverNames.length} server bundle(s) in ${outputRoot}`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Server build failed: ${message}`);
      process.exitCode = 1;
    });
}
