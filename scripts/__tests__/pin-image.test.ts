import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Runs scripts/platform/pin-image.sh against a temp copy of the v2 overlay.
const script = path.resolve(__dirname, '../platform/pin-image.sh');
const overlay = path.resolve(__dirname, '../../deploy/cashight/overlays/v2');
const repo = '010382427026.dkr.ecr.ap-southeast-1.amazonaws.com/cashight-backend';
const digest = `sha256:${'ab12'.repeat(16)}`;
const sha = 'c0ffee0123456789c0ffee0123456789c0ffee01';

let dir: string;

function run(args: string[]) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8' });
}

const read = (file: string) => readFileSync(path.join(dir, file), 'utf8');

// yq is already a platform-script dependency; no YAML package in the repo.
function parse(file: string) {
  const out = spawnSync('yq', ['-o=json', '.', path.join(dir, file)], { encoding: 'utf8' });
  return JSON.parse(out.stdout);
}

describe('pin-image.sh', () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pin-image-'));
    cpSync(overlay, dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('pins a valid digest and records the commit as APP_VERSION', () => {
    const result = run([dir, repo, digest, sha]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const image = parse('kustomization.yaml').images.find(
      (i: { name: string }) => i.name === 'cashight-backend',
    );
    expect(image).toEqual({ name: 'cashight-backend', newName: repo, digest });
    expect(parse('env.yaml').data.APP_VERSION).toBe(sha);
  });

  it('keeps the overlay comments', () => {
    run([dir, repo, digest, sha]);
    expect(read('kustomization.yaml')).toContain('# Rewritten by scripts/platform/pin-image.sh');
  });

  it.each([['latest'], ['sha256:abc'], [`sha256:${'AB12'.repeat(16)}`]])(
    'rejects %s and leaves the overlay unchanged',
    (bad) => {
      const before = read('kustomization.yaml');
      const result = run([dir, repo, bad, sha]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('digest');
      expect(read('kustomization.yaml')).toBe(before);
    },
  );

  it('rejects a commit that is not a full SHA', () => {
    const before = read('env.yaml');
    const result = run([dir, repo, digest, 'main']);
    expect(result.status).toBe(1);
    expect(read('env.yaml')).toBe(before);
  });
});
