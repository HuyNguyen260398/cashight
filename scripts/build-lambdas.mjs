import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, '..');

async function discoverHandlers(projectRoot) {
  const functionsRoot = path.join(projectRoot, 'backend/functions');
  let entries;
  try {
    entries = await readdir(functionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      functionName: entry.name,
      handlerPath: path.join(functionsRoot, entry.name, 'handler.ts'),
    }))
    .sort((left, right) =>
      left.functionName < right.functionName
        ? -1
        : left.functionName > right.functionName
          ? 1
          : 0,
    );
}

export async function buildLambdas({ projectRoot = defaultProjectRoot } = {}) {
  const outputRoot = path.join(projectRoot, 'dist/lambdas');
  const handlers = await discoverHandlers(projectRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const { functionName, handlerPath } of handlers) {
    const outputDirectory = path.join(outputRoot, functionName);
    await mkdir(outputDirectory, { recursive: true });
    const workerSource = path.join(
      projectRoot,
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    );
    if (functionName === 'parser-worker') {
      try {
        await copyFile(workerSource, path.join(outputDirectory, 'pdf.worker.mjs'));
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          throw new Error(
            `pdf.worker.mjs is required for parser-worker: ${workerSource}`,
          );
        }
        throw error;
      }
    }

    await build({
      absWorkingDir: projectRoot,
      entryPoints: [path.relative(projectRoot, handlerPath)],
      outfile: path.join(outputDirectory, 'index.js'),
      bundle: true,
      format: 'cjs',
      logLevel: 'silent',
      platform: 'node',
      sourcemap: 'external',
      target: 'node22',
    });
  }

  return {
    functionNames: handlers.map(({ functionName }) => functionName),
    outputRoot,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  buildLambdas()
    .then(({ functionNames, outputRoot }) => {
      console.log(
        `Built ${functionNames.length} Lambda function(s) in ${outputRoot}`,
      );
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Lambda build failed: ${message}`);
      process.exitCode = 1;
    });
}
