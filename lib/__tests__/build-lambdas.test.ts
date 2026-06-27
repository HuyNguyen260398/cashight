import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildLambdas } from '@/scripts/build-lambdas.mjs';

const temporaryDirectories: string[] = [];

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cashight-lambdas-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeHandler(projectRoot: string, name: string): Promise<void> {
  const functionDirectory = path.join(
    projectRoot,
    'backend/functions',
    name,
  );
  await mkdir(functionDirectory, { recursive: true });
  await writeFile(
    path.join(functionDirectory, 'handler.ts'),
    `export const handler = async () => ({ statusCode: 200, body: '${name}' });\n`,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('buildLambdas', () => {
  it('bundles discovered handlers and copies the parser worker', async () => {
    const projectRoot = await temporaryProject();
    await writeHandler(projectRoot, 'health');
    await writeHandler(projectRoot, 'parser-worker');
    const workerPath = path.join(
      projectRoot,
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    );
    await mkdir(path.dirname(workerPath), { recursive: true });
    await writeFile(workerPath, 'worker fixture');

    const result = await buildLambdas({ projectRoot });

    expect(result.functionNames).toEqual(['health', 'parser-worker']);
    for (const functionName of result.functionNames) {
      const outputDirectory = path.join(
        projectRoot,
        'dist/lambdas',
        functionName,
      );
      expect(
        await readFile(path.join(outputDirectory, 'index.js'), 'utf8'),
      ).toContain('statusCode');
      expect(
        await readFile(path.join(outputDirectory, 'index.js.map'), 'utf8'),
      ).toContain('handler.ts');
    }
    expect(
      await readFile(
        path.join(
          projectRoot,
          'dist/lambdas/parser-worker/pdf.worker.mjs',
        ),
        'utf8',
      ),
    ).toBe('worker fixture');
  });

  it('fails parser-worker builds when the pdfjs worker is missing', async () => {
    const projectRoot = await temporaryProject();
    await writeHandler(projectRoot, 'parser-worker');

    await expect(buildLambdas({ projectRoot })).rejects.toThrow(
      'pdf.worker.mjs is required for parser-worker',
    );
  });
});
