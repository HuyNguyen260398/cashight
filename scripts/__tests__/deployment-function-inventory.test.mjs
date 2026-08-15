import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function workflowFunctions(source) {
  const match = source.match(/FUNCTIONS=\(([^)]+)\)/);
  if (!match) throw new Error('Application deploy function list not found.');
  return match[1].trim().split(/\s+/).sort();
}

function manifestFunctions(source) {
  const match = source.match(/const FUNCTION_NAMES = \[([\s\S]*?)\];/);
  if (!match) throw new Error('Release manifest function list not found.');
  return [...match[1].matchAll(/'([^']+)'/g)]
    .map((entry) => entry[1])
    .sort();
}

describe('deployment function inventory', () => {
  it('verifies every deploy target exists before mutating any function', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github/workflows/application-deploy.yaml'),
      'utf8',
    );

    // A function this branch adds only exists after Infrastructure Deploy runs
    // `terraform apply`. Without a pre-flight check the deploy loop publishes
    // and traffic-shifts the functions that do exist, then dies on the first
    // one that does not — leaving production partially deployed.
    const preflight = workflow.indexOf('aws lambda get-function ');
    const mutation = workflow.indexOf('aws lambda update-function-code');

    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(mutation);
    // The failure has to name the missing functions and the fix.
    expect(workflow).toMatch(/MISSING/);
    expect(workflow).toMatch(/Infrastructure Deploy/);
  });

  it('keeps built, deployed, and release-manifest Lambda lists identical', async () => {
    const [functionEntries, workflow, manifest] = await Promise.all([
      readdir(path.join(projectRoot, 'backend/functions'), {
        withFileTypes: true,
      }),
      readFile(
        path.join(projectRoot, '.github/workflows/application-deploy.yaml'),
        'utf8',
      ),
      readFile(
        path.join(projectRoot, 'scripts/create-release-manifest.mjs'),
        'utf8',
      ),
    ]);
    const built = functionEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(workflowFunctions(workflow)).toEqual(built);
    expect(manifestFunctions(manifest)).toEqual(built);
  });
});
