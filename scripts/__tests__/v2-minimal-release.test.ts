import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// .github/workflows/v2-minimal-release.yaml and the scripts it runs. The
// scripts run with stub CLIs first on PATH; each stub appends "<tool> <args>"
// to $CALLS so the tests can assert what ran, and in which order.
const root = path.resolve(__dirname, '../..');
const workflowFile = path.join(root, '.github/workflows/v2-minimal-release.yaml');
const scripts = {
  deployWorkers: path.join(root, 'scripts/v2-minimal/deploy-workers.sh'),
  recordRevision: path.join(root, 'scripts/v2-minimal/record-revision.sh'),
  waitRevision: path.join(root, 'scripts/v2-minimal/wait-revision.sh'),
  rollback: path.join(root, 'scripts/v2-minimal/rollback.sh'),
  mintToken: path.join(root, 'scripts/platform/mint-smoke-token.sh'),
};

const PARSER = 'cashight-v2-parser-worker';
const INVOICE = 'cashight-v2-invoice-parser-worker';

let dir: string;
let calls: string;

function stub(name: string, body: string) {
  const file = path.join(dir, 'bin', name);
  writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >> "$CALLS"\n${body}\n`);
  chmodSync(file, 0o755);
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
      ...env,
    },
  });
}

function recorded() {
  return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'v2-minimal-release-'));
  mkdirSync(path.join(dir, 'bin'));
  calls = path.join(dir, 'calls.log');
  writeFileSync(calls, '');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ── workflow ──────────────────────────────────────────────────────────────────

interface Step {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  needs?: string | string[];
  environment?: unknown;
  steps: Step[];
}

function workflow() {
  const out = spawnSync('yq', ['-o=json', '.', workflowFile], { encoding: 'utf8' });
  expect(out.status).toBe(0);
  return JSON.parse(out.stdout) as {
    on: { push: { branches: string[]; paths: string[] }; workflow_dispatch?: unknown };
    concurrency: unknown;
    jobs: Record<string, Job>;
  };
}

describe('v2-minimal-release workflow', () => {
  it('runs on pushes to cashight-v2 that touch the app, the overlay or itself, and on dispatch', () => {
    const { on } = workflow();
    expect(on.push.branches).toEqual(['cashight-v2']);
    expect(on.push.paths).toEqual(
      expect.arrayContaining([
        'backend/**',
        'app/**',
        'deploy/cashight/overlays/v2-minimal/**',
        '.github/workflows/v2-minimal-release.yaml',
      ]),
    );
    expect(on).toHaveProperty('workflow_dispatch');
  });

  it('runs one release at a time without cancelling one in progress', () => {
    expect(workflow().concurrency).toEqual({ group: 'v2-minimal-release', 'cancel-in-progress': false });
  });

  it('runs every job only when V2_TARGET is minimal, and sets no environment', () => {
    const jobs = Object.entries(workflow().jobs);
    expect(jobs.length).toBe(3);
    for (const [name, job] of jobs) {
      expect(job.if ?? '', name).toContain("vars.V2_TARGET == 'minimal'");
      expect(job.environment, name).toBeUndefined();
    }
  });

  it('deploys the SPA only after the API checks, with AI summaries off', () => {
    const { spa } = workflow().jobs;
    expect([spa.needs].flat()).toContain('deploy');
    const build = spa.steps.find((s) => s.env && 'NEXT_PUBLIC_ENABLE_AI_SUMMARY' in s.env);
    expect(build?.env?.NEXT_PUBLIC_ENABLE_AI_SUMMARY).toBe('false');
  });

  it('rolls back on failure, after the revision check', () => {
    const steps = workflow().jobs.deploy.steps;
    const wait = steps.findIndex((s) => s.run?.includes('wait-revision.sh'));
    const rollback = steps.findIndex((s) => s.run?.includes('rollback.sh'));
    expect(wait).toBeGreaterThan(-1);
    expect(rollback).toBeGreaterThan(wait);
    expect(steps[rollback].if).toBe('failure()');
  });

  it('records the rollback state before changing anything', () => {
    const steps = workflow().jobs.deploy.steps;
    const record = steps.findIndex((s) => s.run?.includes('record-revision.sh'));
    const workers = steps.findIndex((s) => s.run?.includes('deploy-workers.sh'));
    const apply = steps.findIndex((s) => s.run?.includes('kubectl apply -k'));
    expect(record).toBeGreaterThan(-1);
    expect(record).toBeLessThan(workers);
    expect(workers).toBeLessThan(apply);
  });

  it('stamps the app-version annotation on every release, so a config-only change restarts the pod', () => {
    const steps = workflow().jobs.deploy.steps;
    const pin = steps.find((s) => s.run?.includes('pin-image.sh'));
    expect(pin?.run).toContain('cashight.nghuy.link/app-version');
  });

  it('asserts the summary routes are off in the smoke step', () => {
    const steps = workflow().jobs.deploy.steps;
    const smoke = steps.find((s) => s.run?.includes('smoke-serverless.mjs'));
    expect(smoke?.env?.SMOKE_EXPECT_AI_SUMMARY_DISABLED).toBe('true');
    expect(smoke?.env?.SMOKE_REQUIRE_NATIVE_AUTH).toBe('true');
  });

  it('never pushes to git from the deploy job', () => {
    const steps = workflow().jobs.deploy.steps;
    expect(steps.filter((s) => s.run?.includes('git push'))).toEqual([]);
  });
});

// ── wait-revision.sh ─────────────────────────────────────────────────────────

describe('wait-revision.sh', () => {
  it('keeps polling until /health reports the new revision', () => {
    const counter = path.join(dir, 'count');
    writeFileSync(counter, '0');
    stub(
      'curl',
      `n=$(cat "${counter}"); echo $((n + 1)) > "${counter}"
if [ "$n" -lt 2 ]; then echo '{"status":"ok","revision":"old1234"}'; else echo '{"status":"ok","revision":"new5678"}'; fi`,
    );
    const result = run(scripts.waitRevision, ['https://api.example.test', 'new5678', '30']);
    expect(result.status).toBe(0);
    expect(recorded().filter((l) => l.startsWith('curl')).length).toBe(3);
    expect(recorded()[0]).toContain('https://api.example.test/health');
  });

  it('fails with the last revision seen when the new one never answers', () => {
    stub('curl', `echo '{"status":"ok","revision":"old1234"}'`);
    const result = run(scripts.waitRevision, ['https://api.example.test', 'new5678', '1']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('last revision seen: old1234');
  });

  it('rejects a malformed expected hash', () => {
    stub('curl', 'exit 0');
    const result = run(scripts.waitRevision, ['https://api.example.test', 'NOT A HASH']);
    expect(result.status).toBe(1);
    expect(recorded()).toEqual([]);
  });
});

// ── record-revision.sh ───────────────────────────────────────────────────────

describe('record-revision.sh', () => {
  it('records the live deployment revision', () => {
    stub('kubectl', 'echo 4');
    const state = path.join(dir, 'state');
    writeFileSync(state, '');
    const result = run(scripts.recordRevision, [state]);
    expect(result.status).toBe(0);
    expect(readFileSync(state, 'utf8')).toBe('deployment=4\n');
  });

  it('records nothing on the first deploy, when there is no deployment yet', () => {
    stub('kubectl', 'echo "Error from server (NotFound)" >&2; exit 1');
    const state = path.join(dir, 'state');
    writeFileSync(state, '');
    const result = run(scripts.recordRevision, [state]);
    expect(result.status).toBe(0);
    expect(readFileSync(state, 'utf8')).toBe('');
    expect(result.stdout).toContain('no previous revision');
  });
});

// ── deploy-workers.sh ────────────────────────────────────────────────────────

describe('deploy-workers.sh', () => {
  function distWithWorkers() {
    const dist = path.join(dir, 'dist');
    for (const name of ['parser-worker', 'invoice-parser-worker']) {
      mkdirSync(path.join(dist, name), { recursive: true });
      writeFileSync(path.join(dist, name, 'index.js'), 'exports.handler = async () => {};');
      writeFileSync(path.join(dist, name, 'pdf.worker.mjs'), '// worker');
    }
    return dist;
  }

  it('records both live versions before updating any code, then publishes and moves the aliases', () => {
    const state = path.join(dir, 'state');
    writeFileSync(state, '');
    stub(
      'aws',
      `case "$*" in
  *"get-alias"*"${INVOICE}"*) echo 3 ;;
  *"get-alias"*"${PARSER}"*) echo 7 ;;
  *"update-function-code"*"${INVOICE}"*) echo 4 ;;
  *"update-function-code"*"${PARSER}"*) echo 8 ;;
  *"update-function-code"*) echo "state at update: $(cat '${state}' | tr '\\n' ' ')" >> "$CALLS" ;;
esac
exit 0`,
    );
    const result = run(scripts.deployWorkers, [distWithWorkers(), state]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(state, 'utf8')).toBe(`${PARSER}=7\n${INVOICE}=3\n`);

    const log = recorded();
    const lastGetAlias = log.findLastIndex((l) => l.includes('get-alias'));
    const firstUpdate = log.findIndex((l) => l.includes('update-function-code'));
    expect(lastGetAlias).toBeGreaterThan(-1);
    expect(firstUpdate).toBeGreaterThan(lastGetAlias);
    expect(log.some((l) => l.includes('update-function-code') && l.includes('--publish') && l.includes('--zip-file fileb://'))).toBe(true);
    expect(log).toContainEqual(expect.stringContaining(`update-alias --function-name ${PARSER} --name live --function-version 8`));
    expect(log).toContainEqual(expect.stringContaining(`update-alias --function-name ${INVOICE} --name live --function-version 4`));
    // The alias moves only after the function finished updating.
    const wait = log.findIndex((l) => l.includes('wait function-updated') && l.includes(PARSER));
    const alias = log.findIndex((l) => l.includes('update-alias') && l.includes(PARSER));
    expect(wait).toBeGreaterThan(-1);
    expect(alias).toBeGreaterThan(wait);
  });

  it('fails before touching code when a worker bundle is missing', () => {
    const state = path.join(dir, 'state');
    writeFileSync(state, '');
    stub('aws', 'echo 1');
    const result = run(scripts.deployWorkers, [path.join(dir, 'empty'), state]);
    expect(result.status).toBe(1);
    expect(recorded().filter((l) => l.includes('update-function-code'))).toEqual([]);
  });
});

// ── rollback.sh ──────────────────────────────────────────────────────────────

describe('rollback.sh', () => {
  function kubectlAtRevision(current: string) {
    stub(
      'kubectl',
      `case "$*" in
  *"get deployment"*) echo ${current} ;;
esac
exit 0`,
    );
  }

  it('undoes the deployment to the recorded revision, restores both aliases and fails', () => {
    kubectlAtRevision('5');
    stub('aws', 'exit 0');
    const state = path.join(dir, 'state');
    writeFileSync(state, `deployment=4\n${PARSER}=7\n${INVOICE}=3\n`);
    const result = run(scripts.rollback, [state]);
    expect(result.status).toBe(1);
    const log = recorded();
    expect(log).toContainEqual(expect.stringContaining('rollout undo deployment/cashight-api -n cashight --to-revision=4'));
    expect(log).toContainEqual(expect.stringContaining('rollout status deployment/cashight-api -n cashight --timeout=5m'));
    expect(log).toContainEqual(expect.stringContaining(`update-alias --function-name ${PARSER} --name live --function-version 7`));
    expect(log).toContainEqual(expect.stringContaining(`update-alias --function-name ${INVOICE} --name live --function-version 3`));
  });

  it('restores an alias even when only one had moved', () => {
    kubectlAtRevision('4');
    stub('aws', 'exit 0');
    const state = path.join(dir, 'state');
    // deploy-workers.sh failed while updating the second function.
    writeFileSync(state, `deployment=4\n${PARSER}=7\n${INVOICE}=3\n`);
    const result = run(scripts.rollback, [state]);
    expect(result.status).toBe(1);
    expect(recorded().filter((l) => l.includes('update-alias'))).toHaveLength(2);
  });

  it('skips the undo when the deployment never changed', () => {
    kubectlAtRevision('4');
    stub('aws', 'exit 0');
    const state = path.join(dir, 'state');
    writeFileSync(state, `deployment=4\n${PARSER}=7\n`);
    const result = run(scripts.rollback, [state]);
    expect(result.status).toBe(1);
    expect(recorded().filter((l) => l.includes('rollout undo'))).toEqual([]);
    expect(result.stdout).toContain('unchanged');
  });

  it('says there is no previous revision on the first deploy, and still fails', () => {
    kubectlAtRevision('1');
    stub('aws', 'exit 0');
    const state = path.join(dir, 'state');
    writeFileSync(state, `${PARSER}=1\n${INVOICE}=1\n`);
    const result = run(scripts.rollback, [state]);
    expect(result.status).toBe(1);
    expect(recorded().filter((l) => l.includes('rollout undo'))).toEqual([]);
    expect(result.stdout).toContain('no previous revision');
  });

  it('restores no alias when none was recorded, and still fails', () => {
    kubectlAtRevision('1');
    stub('aws', 'exit 0');
    const state = path.join(dir, 'state');
    writeFileSync(state, '');
    const result = run(scripts.rollback, [state]);
    expect(result.status).toBe(1);
    expect(recorded().filter((l) => l.includes('update-alias'))).toEqual([]);
  });

  it('keeps going when one rollback step errors, and still fails', () => {
    stub(
      'kubectl',
      `case "$*" in
  *"get deployment"*) echo 5 ;;
  *"rollout undo"*) exit 1 ;;
esac
exit 0`,
    );
    stub('aws', 'exit 0');
    const state = path.join(dir, 'state');
    writeFileSync(state, `deployment=4\n${PARSER}=7\n`);
    const result = run(scripts.rollback, [state]);
    expect(result.status).toBe(1);
    expect(recorded().filter((l) => l.includes('update-alias'))).toHaveLength(1);
  });
});

// ── mint-smoke-token.sh ──────────────────────────────────────────────────────

describe('mint-smoke-token.sh', () => {
  const env = {
    COGNITO_USER_POOL_ID: 'ap-southeast-1_stub',
    COGNITO_SMOKE_CLIENT_ID: 'smokeclient',
    COGNITO_HOSTED_UI_DOMAIN: 'https://auth.example.test',
  };

  it('prints the access token and never the client secret', () => {
    stub('aws', 'echo stub-secret');
    stub('curl', `echo '{"access_token":"stub-token"}'`);
    const result = run(scripts.mintToken, [], env);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('stub-token');
    expect(`${result.stdout}${result.stderr}`).not.toContain('stub-secret');
    expect(recorded()).toContainEqual(expect.stringContaining('https://auth.example.test/oauth2/token'));
  });

  it('exits 1 with the OAuth error code and no token', () => {
    stub('aws', 'echo stub-secret');
    stub('curl', `echo '{"error":"invalid_client"}'`);
    const result = run(scripts.mintToken, [], env);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('invalid_client');
    expect(result.stderr).not.toContain('stub-secret');
  });

  it('falls back to gh variable get for unset values', () => {
    stub('aws', 'echo stub-secret');
    stub('curl', `echo '{"access_token":"stub-token"}'`);
    stub('gh', 'echo "https://from-gh.example.test"');
    const result = run(scripts.mintToken, [], { ...env, COGNITO_HOSTED_UI_DOMAIN: '' });
    expect(result.status).toBe(0);
    expect(recorded()).toContainEqual('gh variable get COGNITO_HOSTED_UI_DOMAIN');
  });
});
