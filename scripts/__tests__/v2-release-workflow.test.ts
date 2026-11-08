import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the properties of .github/workflows/v2-release.yaml that only fail
// on a real run: the OIDC trust, the release race, and the node architecture.
const file = process.env.V2_RELEASE_WORKFLOW ?? path.resolve(__dirname, '../../.github/workflows/v2-release.yaml');

function workflow() {
  const out = spawnSync('yq', ['-o=json', '.', file], { encoding: 'utf8' });
  expect(out.status).toBe(0);
  return JSON.parse(out.stdout);
}

describe('v2-release workflow', () => {
  it('sets no environment on any job, so the OIDC subject stays ref:refs/heads/cashight-v2', () => {
    const jobs = Object.entries(workflow().jobs as Record<string, { environment?: unknown }>);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.filter(([, job]) => job.environment !== undefined).map(([name]) => name)).toEqual([]);
  });

  it('runs one release at a time without cancelling a pin in progress', () => {
    expect(workflow().concurrency).toEqual({ group: 'v2-release', 'cancel-in-progress': false });
  });

  it('builds the image natively for the arm64 nodes', () => {
    expect(workflow().jobs.image['runs-on']).toBe('ubuntu-24.04-arm');
  });

  it('runs only for the cashight-v2 branch', () => {
    expect(workflow().on.push.branches).toEqual(['cashight-v2']);
  });
});
