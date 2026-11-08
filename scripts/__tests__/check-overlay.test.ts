import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Runs scripts/platform/check-overlay.sh against the committed v2 overlay with
// fixture `terraform output -json` documents instead of live state.
const script = path.resolve(__dirname, '../platform/check-overlay.sh');

const v2Outputs = {
  table_name: 'cashight-v2',
  statements_bucket_name: 'cashight-v2-statements-010382427026',
  uploads_bucket_name: 'cashight-v2-uploads-010382427026',
  cost_exports_bucket_name: 'cashight-v2-cost-exports-010382427026',
  parse_queue_url: 'https://sqs.ap-southeast-1.amazonaws.com/010382427026/cashight-v2-parse',
  invoice_parse_queue_url: 'https://sqs.ap-southeast-1.amazonaws.com/010382427026/cashight-v2-invoice-parse',
  cognito_user_pool_id: 'ap-southeast-1_ZazpeBFju',
  api_certificate_arn:
    'arn:aws:acm:ap-southeast-1:010382427026:certificate/3100f36d-b704-42c9-87da-a62ffad14d37',
  ecr_repository_url: '010382427026.dkr.ecr.ap-southeast-1.amazonaws.com/cashight-backend',
};

const platformOutputs = {
  gitops_repo_url:
    'https://codeconnections.ap-southeast-1.amazonaws.com/git-http/010382427026/ap-southeast-1/d3d7e032-c805-4557-b706-cd83ebe3df30/HuyNguyen260398/cashight.git',
  keda_scaler_role_arns: {
    parse: 'arn:aws:iam::010382427026:role/cashight-v2-keda-parse',
    invoice_parse: 'arn:aws:iam::010382427026:role/cashight-v2-keda-invoice-parse',
  },
};

// `terraform output -json` wraps every value as { value, type, sensitive }.
function asTerraformOutput(values: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, sensitive: false }])),
  );
}

let dir: string;

function run(v2: Record<string, unknown>, platform: Record<string, unknown>) {
  const v2File = path.join(dir, 'v2.json');
  const platformFile = path.join(dir, 'platform.json');
  writeFileSync(v2File, asTerraformOutput(v2));
  writeFileSync(platformFile, asTerraformOutput(platform));
  return spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, V2_OUTPUTS_JSON: v2File, PLATFORM_OUTPUTS_JSON: platformFile },
  });
}

describe('check-overlay.sh', () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'check-overlay-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes when every committed value matches the outputs', () => {
    const result = run(v2Outputs, platformOutputs);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('names the key whose committed value differs', () => {
    const result = run({ ...v2Outputs, statements_bucket_name: 'cashight-v2-statements-999999999999' }, platformOutputs);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STATEMENTS_BUCKET');
    expect(result.stderr).not.toContain('UPLOAD_BUCKET');
  });

  it('checks the certificate, scaler roles, image repository and GitOps URL', () => {
    const result = run(
      {
        ...v2Outputs,
        api_certificate_arn: 'arn:aws:acm:ap-southeast-1:010382427026:certificate/other',
        ecr_repository_url: '010382427026.dkr.ecr.ap-southeast-1.amazonaws.com/other',
      },
      {
        gitops_repo_url: 'https://example.invalid/cashight.git',
        keda_scaler_role_arns: { ...platformOutputs.keda_scaler_role_arns, parse: 'arn:aws:iam::010382427026:role/x' },
      },
    );
    expect(result.status).toBe(1);
    for (const key of ['certificate-arn', 'roleArn (parse-queue)', 'images newName', 'repoURL']) {
      expect(result.stderr).toContain(key);
    }
  });

  it('fails when an output is missing instead of comparing against null', () => {
    const { table_name: _omitted, ...withoutTable } = v2Outputs;
    const result = run(withoutTable, platformOutputs);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TABLE_NAME');
  });
});
