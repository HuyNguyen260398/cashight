import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// scripts/v2-minimal/{apply,teardown,check-overlay}.sh with stub CLIs first on
// PATH. Every stub appends "<tool> <args>" to $CALLS.
const root = path.resolve(__dirname, '../..');
const apply = path.join(root, 'scripts/v2-minimal/apply.sh');
const teardown = path.join(root, 'scripts/v2-minimal/teardown.sh');
const checkOverlay = path.join(root, 'scripts/v2-minimal/check-overlay.sh');

let dir: string;
let calls: string;

function stub(name: string, body: string) {
  const file = path.join(dir, 'bin', name);
  writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >> "$CALLS"\n${body}\n`);
  chmodSync(file, 0o755);
}

const NOT_FOUND = `echo "An error occurred (ResourceNotFoundException) when calling the DescribeCluster operation" >&2; exit 254`;

function stubAll({ fullClusterExists = false, loadBalancers = '' } = {}) {
  stub('terraform', 'exit 0');
  stub(
    'aws',
    `case "$*" in
  *"eks describe-cluster"*"--name cashight-v2 "*|*"eks describe-cluster"*"--name cashight-v2") ${fullClusterExists ? `echo '{"cluster":{}}'` : NOT_FOUND} ;;
  *"eks describe-cluster"*) ${NOT_FOUND} ;;
  *"elbv2 describe-load-balancers"*) echo "${loadBalancers}" ;;
esac
exit 0`,
  );
  stub('kubectl', 'exit 0');
  stub('gh', 'exit 0');
  stub('check-overlay', 'exit 0');
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
      ...env,
    },
  });
}

function recorded() {
  return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
}

function indexOf(log: string[], ...fragments: string[]) {
  return log.findIndex((line) => fragments.every((f) => line.includes(f)));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'v2-minimal-scripts-'));
  mkdirSync(path.join(dir, 'bin'));
  calls = path.join(dir, 'calls.log');
  writeFileSync(calls, '');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('apply.sh', () => {
  it('refuses while the full cluster cashight-v2 exists, before any terraform call', () => {
    stubAll({ fullClusterExists: true });
    const result = run(apply, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cashight-v2 exists');
    expect(recorded().filter((l) => l.startsWith('terraform'))).toEqual([]);
  });

  it('applies the cluster, then everything, checks the overlay, then selects minimal releases', () => {
    stubAll();
    const result = run(apply, []);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const log = recorded();
    const steps = [
      indexOf(log, 'terraform', '-chdir=terraform/v2-minimal', 'plan', '-target=module.cluster'),
      log.findIndex((l) => l.includes('-chdir=terraform/v2-minimal') && l.includes(' plan ') && !l.includes('-target')),
      indexOf(log, 'check-overlay'),
      indexOf(log, 'gh', 'variable set V2_TARGET --body minimal'),
    ];
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    // Each plan is applied from its file.
    expect(log.filter((l) => l.includes('-chdir=terraform/v2-minimal apply')).length).toBe(2);
    expect(result.stdout).toContain('v2-minimal-release.yaml');
  });

  it('stops before switching V2_TARGET when the overlay disagrees with Terraform', () => {
    stubAll();
    stub('check-overlay', 'echo "FAIL: UPLOAD_BUCKET" >&2; exit 1');
    const result = run(apply, []);
    expect(result.status).toBe(1);
    expect(indexOf(recorded(), 'gh', 'variable set')).toBe(-1);
  });
});

describe('teardown.sh', () => {
  it('refuses without the literal argument and makes no calls', () => {
    stubAll();
    const result = run(teardown, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"destroy cashight-v2-min"');
    expect(recorded()).toEqual([]);
  });

  it('turns Grafana off, deletes the Ingress, waits for the ALB, destroys, then selects full releases', () => {
    stubAll();
    const result = run(teardown, ['destroy cashight-v2-min']);
    expect(result.status).toBe(0);
    const log = recorded();
    const steps = [
      indexOf(log, 'terraform', '-chdir=terraform/grafana', '-var api_live=false'),
      indexOf(log, 'kubectl', 'delete ingress cashight -n cashight'),
      indexOf(log, 'aws', 'elbv2 describe-load-balancers'),
      indexOf(log, 'terraform', '-chdir=terraform/v2-minimal', 'destroy'),
      indexOf(log, 'gh', 'variable set V2_TARGET --body full'),
    ];
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('stops before the destroy when a cashight load balancer survives the wait', () => {
    stubAll({ loadBalancers: 'k8s-cashight-0123456789' });
    const result = run(teardown, ['destroy cashight-v2-min'], { ALB_TIMEOUT_SECONDS: '0' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('k8s-cashight-0123456789');
    expect(indexOf(recorded(), 'terraform', '-chdir=terraform/v2-minimal')).toBe(-1);
    expect(indexOf(recorded(), 'gh', 'variable set')).toBe(-1);
  });
});

describe('check-overlay.sh', () => {
  const v2Outputs = {
    table_name: 'cashight-v2',
    statements_bucket_name: 'cashight-v2-statements-010382427026',
    uploads_bucket_name: 'cashight-v2-uploads-010382427026',
    cost_exports_bucket_name: 'cashight-v2-cost-exports-010382427026',
    cognito_user_pool_id: 'ap-southeast-1_ZazpeBFju',
    api_certificate_arn:
      'arn:aws:acm:ap-southeast-1:010382427026:certificate/3100f36d-b704-42c9-87da-a62ffad14d37',
    ecr_repository_url: '010382427026.dkr.ecr.ap-southeast-1.amazonaws.com/cashight-backend',
  };
  const minimalOutputs = {
    api_role_arn: 'arn:aws:iam::010382427026:role/cashight-v2-min-api',
    api_certificate_arn: v2Outputs.api_certificate_arn,
  };

  function outputs(values: Record<string, unknown>) {
    const file = path.join(dir, `${Math.random()}.json`);
    writeFileSync(
      file,
      JSON.stringify(Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, sensitive: false }]))),
    );
    return file;
  }

  it('passes when the committed overlay matches Terraform', () => {
    const result = run(checkOverlay, [], {
      V2_OUTPUTS_JSON: outputs(v2Outputs),
      MINIMAL_OUTPUTS_JSON: outputs(minimalOutputs),
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails naming UPLOAD_BUCKET when Terraform disagrees', () => {
    const result = run(checkOverlay, [], {
      V2_OUTPUTS_JSON: outputs({ ...v2Outputs, uploads_bucket_name: 'cashight-v2-uploads-other' }),
      MINIMAL_OUTPUTS_JSON: outputs(minimalOutputs),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('UPLOAD_BUCKET');
  });

  it('fails naming the ServiceAccount role when the API role changed', () => {
    const result = run(checkOverlay, [], {
      V2_OUTPUTS_JSON: outputs(v2Outputs),
      MINIMAL_OUTPUTS_JSON: outputs({ ...minimalOutputs, api_role_arn: 'arn:aws:iam::010382427026:role/other' }),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('role-arn');
  });
});
