import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Runs scripts/platform/destroy-platform.sh with stub `terraform` and `kubectl`
// first on PATH, so the guards are exercised without AWS or a cluster. The real
// jq is used. Every stubbed terraform call other than `state list` fails, so a
// guard that lets the script through shows up as a non-1 exit.
const script = path.resolve(__dirname, '../platform/destroy-platform.sh');

let stubDir: string;

function stub(name: string, body: string) {
  const file = path.join(stubDir, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

function run(args: string[]) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
  });
}

// A live cluster in state, reachable through kubectl, with the given
// Application and Ingress lists.
function liveCluster({ applications, ingresses }: { applications: unknown[]; ingresses: unknown[] }) {
  stub(
    'terraform',
    `case "$*" in
  *"state list"*) echo 'module.platform_cluster.module.eks.aws_eks_cluster.this[0]' ;;
  *) echo "unexpected terraform $*" >&2; exit 99 ;;
esac`,
  );
  stub(
    'kubectl',
    `case "$*" in
  "get --raw /readyz") exit 0 ;;
  "-n argocd get applications -o json") echo '${JSON.stringify({ items: applications })}' ;;
  "get ingress -A -o json") echo '${JSON.stringify({ items: ingresses })}' ;;
  "get svc -A -o json") echo '{"items":[]}' ;;
  *) echo "unexpected kubectl $*" >&2; exit 98 ;;
esac`,
  );
}

describe('destroy-platform.sh guards', () => {
  beforeEach(() => {
    stubDir = mkdtempSync(path.join(tmpdir(), 'destroy-platform-'));
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it('refuses without the literal argument', () => {
    liveCluster({ applications: [], ingresses: [] });
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('pass the literal argument "destroy platform"');
  });

  it('refuses while a multi-source Application sources deploy/cashight', () => {
    liveCluster({
      applications: [
        { metadata: { name: 'cashight' }, spec: { sources: [{ path: 'deploy/cashight/overlays/v2' }] } },
      ],
      ingresses: [],
    });
    const result = run(['destroy platform']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('workload Applications exist');
    expect(result.stderr).toContain('cashight');
  });

  it('refuses while an Ingress exists', () => {
    liveCluster({
      applications: [],
      ingresses: [{ metadata: { namespace: 'cashight', name: 'api' } }],
    });
    const result = run(['destroy platform']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Ingress objects still exist');
    expect(result.stderr).toContain('cashight/api');
  });
});
