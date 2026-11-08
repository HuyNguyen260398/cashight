import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Runs the canary smoke gate from deploy/cashight/base/smoke-analysis.yaml the
// way the Job does (sh -c), with Argo's {{args.*}} substituted and stub curl
// and sleep on PATH. The stub curl answers /health from a scripted sequence.
const root = path.resolve(__dirname, '../..');
const CANARY = '59f56586c';
const STABLE = '66cb59764f';

function smokeScript(): string {
  const out = spawnSync(
    'yq',
    ['-r', '.spec.metrics[0].provider.job.spec.template.spec.containers[0].args[0]', 'deploy/cashight/base/smoke-analysis.yaml'],
    { cwd: root, encoding: 'utf8' },
  );
  expect(out.status).toBe(0);
  return out.stdout
    .replaceAll('{{args.service}}', 'cashight-api-canary')
    .replaceAll('{{args.canary-hash}}', CANARY);
}

let dir: string;

// Each /health call consumes the next answer; the last one repeats.
function run(answers: string[]) {
  writeFileSync(path.join(dir, 'answers'), answers.join('\n') + '\n');
  writeFileSync(
    path.join(dir, 'curl'),
    `#!/bin/sh
n=$(cat "${dir}/n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "${dir}/n"
line=$(sed -n "\${n}p" "${dir}/answers"); [ -n "$line" ] || line=$(tail -n 1 "${dir}/answers")
[ "$line" = "503" ] && exit 22
printf '%s' "$line"
`,
  );
  writeFileSync(path.join(dir, 'sleep'), '#!/bin/sh\nexit 0\n');
  chmodSync(path.join(dir, 'curl'), 0o755);
  chmodSync(path.join(dir, 'sleep'), 0o755);
  return spawnSync('sh', ['-c', smokeScript()], {
    encoding: 'utf8',
    // The stub dir comes first, so the stub curl shadows the system one.
    env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
  });
}

const health = (revision: string) => JSON.stringify({ status: 'ok', revision });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'smoke-analysis-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('canary smoke gate', () => {
  it('passes once the canary Service answers from the canary pods three times in a row', () => {
    const result = run([health(STABLE), '503', health(CANARY), health(CANARY), health(CANARY)]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`canary ${CANARY} healthy`);
  });

  it('fails when only the stable pods ever answer', () => {
    const result = run([health(STABLE)]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`canary ${CANARY} not reached`);
  });

  it('restarts the count when a stable or draining pod answers in between', () => {
    const result = run([health(CANARY), health(CANARY), '503', health(CANARY), health(CANARY), health(STABLE)]);
    expect(result.status).toBe(1);
  });

  it('fails when the canary never becomes healthy', () => {
    expect(run(['503']).status).toBe(1);
  });
});
