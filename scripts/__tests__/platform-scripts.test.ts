import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Runs scripts/platform/bring-up.sh and teardown.sh with stub CLIs first on
// PATH. Every stub appends "<tool> <args>" to $CALLS, so the tests assert the
// order of the steps without AWS, a cluster or Grafana.
const root = path.resolve(__dirname, '../..');
const bringUp = path.join(root, 'scripts/platform/bring-up.sh');
const teardown = path.join(root, 'scripts/platform/teardown.sh');

let dir: string;
let calls: string;

function stub(name: string, body: string) {
  const file = path.join(dir, 'bin', name);
  writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >> "$CALLS"\n${body}\n`);
  chmodSync(file, 0o755);
}

function stubAll({ loadBalancers = '' }: { loadBalancers?: string } = {}) {
  stub(
    'terraform',
    `case "$*" in
  *"output -raw cluster_name"*) echo cashight-v2 ;;
esac
exit 0`,
  );
  stub(
    'aws',
    `case "$*" in
  *"eks describe-capability"*) echo ACTIVE ;;
  *"elbv2 describe-load-balancers"*) echo "${loadBalancers}" ;;
  *"describe-user-pool-client"*) echo stub-secret ;;
esac
exit 0`,
  );
  stub(
    'kubectl',
    `case "$*" in
  *"get application cashight"*) echo 'Synced Healthy' ;;
  *"get ingress cashight"*) echo 'k8s-cashight-0123456789-111111111.ap-southeast-1.elb.amazonaws.com' ;;
  *"get ingress -A"*) echo '' ;;
esac
exit 0`,
  );
  stub('pnpm', 'exit 0');
  stub('node', 'exit 0');
  stub('dig', 'echo 203.0.113.7');
  stub(
    'curl',
    `case "$*" in
  *oauth2/token*) echo '{"access_token":"stub-token"}' ;;
  *) echo 200 ;;
esac`,
  );
  stub('gh', 'echo "stub-$4"');
  for (const script of ['check-overlay', 'destroy-platform']) {
    stub(script, 'exit 0');
  }
}

function overlayWithDigest(digest: string) {
  const overlay = path.join(dir, 'overlay');
  cpSync(path.join(root, 'deploy/cashight/overlays/v2'), overlay, { recursive: true });
  spawnSync('yq', ['-i', `(.images[] | select(.name == "cashight-backend")).digest = "${digest}"`, path.join(overlay, 'kustomization.yaml')]);
  return overlay;
}

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
      CALLS: calls,
      POLL_SECONDS: '0',
      CHECK_OVERLAY: path.join(dir, 'bin', 'check-overlay'),
      DESTROY_PLATFORM: path.join(dir, 'bin', 'destroy-platform'),
      ...env,
    },
  });
}

function recorded() {
  return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
}

// Index of the first recorded call matching every fragment, or -1.
function indexOf(log: string[], ...fragments: string[]) {
  return log.findIndex((line) => fragments.every((f) => line.includes(f)));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'platform-scripts-'));
  spawnSync('mkdir', [path.join(dir, 'bin')]);
  calls = path.join(dir, 'calls.log');
  writeFileSync(calls, '');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('bring-up.sh', () => {
  it('refuses the placeholder digest before touching Terraform', () => {
    stubAll();
    const result = run(bringUp, [], { OVERLAY: overlayWithDigest(`sha256:${'0'.repeat(64)}`) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not built yet');
    expect(recorded().filter((l) => l.startsWith('terraform'))).toEqual([]);
  });

  it('applies in order and turns Grafana on only after smoke passes', () => {
    stubAll();
    const result = run(bringUp, [], { OVERLAY: overlayWithDigest(`sha256:${'ab'.repeat(32)}`) });
    expect(result.stderr).not.toContain('stub-token');
    expect(result.status).toBe(0);

    const log = recorded();
    const steps = [
      indexOf(log, 'terraform', '-chdir=terraform/v2', 'init'),
      indexOf(log, 'pnpm', 'seed-authz', '--dry-run'),
      log.findIndex((l) => l.includes('seed-authz') && !l.includes('--dry-run')),
      indexOf(log, 'terraform', '-chdir=terraform/platform', '-target=module.platform_cluster'),
      indexOf(log, 'aws', 'eks describe-capability'),
      indexOf(log, 'aws', 'eks update-kubeconfig'),
      indexOf(log, 'terraform', '-chdir=terraform/platform', 'plan', '-var api_alb_ready=false'),
      indexOf(log, 'kubectl', 'get application cashight'),
      indexOf(log, 'terraform', '-chdir=terraform/platform', 'plan', '-var api_alb_ready=true'),
      indexOf(log, 'check-overlay'),
      indexOf(log, 'node', 'scripts/smoke-serverless.mjs'),
      indexOf(log, 'terraform', '-chdir=terraform/grafana', '-var api_live=true', '-var collector_live=true'),
    ];
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('stops before Grafana when the overlay disagrees with Terraform', () => {
    stubAll();
    stub('check-overlay', 'echo "FAIL: STATEMENTS_BUCKET" >&2; exit 1');
    const result = run(bringUp, [], { OVERLAY: overlayWithDigest(`sha256:${'ab'.repeat(32)}`) });
    expect(result.status).toBe(1);
    const log = recorded();
    expect(indexOf(log, 'node', 'smoke-serverless')).toBe(-1);
    expect(indexOf(log, 'terraform', '-chdir=terraform/grafana')).toBe(-1);
  });
});

describe('teardown.sh', () => {
  it('refuses without the literal argument', () => {
    stubAll();
    const result = run(teardown, []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"destroy cashight-v2"');
    expect(recorded()).toEqual([]);
  });

  it('turns Grafana off, removes the workloads, waits for the ALB, then destroys', () => {
    stubAll();
    const result = run(teardown, ['destroy cashight-v2']);
    expect(result.status).toBe(0);

    const log = recorded();
    const steps = [
      indexOf(log, 'terraform', '-chdir=terraform/grafana', '-var api_live=false', '-var collector_live=false'),
      indexOf(log, 'kubectl', 'delete applicationset platform-workloads'),
      indexOf(log, 'kubectl', 'delete application cashight'),
      indexOf(log, 'aws', 'elbv2 describe-load-balancers'),
      indexOf(log, 'destroy-platform', 'destroy platform'),
    ];
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('stops when a cashight load balancer survives the wait', () => {
    stubAll({ loadBalancers: 'k8s-cashight-0123456789' });
    const result = run(teardown, ['destroy cashight-v2'], { ALB_TIMEOUT_SECONDS: '0' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('k8s-cashight-0123456789');
    expect(indexOf(recorded(), 'destroy-platform')).toBe(-1);
  });
});
