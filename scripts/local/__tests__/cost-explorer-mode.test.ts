import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CostExplorerAwsAdapter } from '../../../backend/functions/cost-explorer-api/aws-adapter';

// handlers.ts touches the file-backed store at import time; keep it away from
// the developer's real .local-data.
let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cashight-ce-mode-'));
  process.env.LOCAL_DATA_DIR = dataDir;
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  delete process.env.LOCAL_DATA_DIR;
});

describe('resolveCostExplorerMode', () => {
  it('defaults to the fake adapter, so `pnpm dev:local` still needs no AWS account', async () => {
    const { resolveCostExplorerMode } = await import('../handlers');
    expect(resolveCostExplorerMode({})).toBe('fake');
  });

  it.each(['real', 'REAL', '  Real  '])('opts in on LOCAL_AWS_COST_EXPLORER=%j', async (value) => {
    const { resolveCostExplorerMode } = await import('../handlers');
    expect(
      resolveCostExplorerMode({ LOCAL_AWS_COST_EXPLORER: value }),
    ).toBe('real');
  });

  it.each(['', 'true', 'fake', 'yes', '1'])(
    'keeps the fake adapter for LOCAL_AWS_COST_EXPLORER=%j — only "real" bills the account',
    async (value) => {
      const { resolveCostExplorerMode } = await import('../handlers');
      expect(
        resolveCostExplorerMode({ LOCAL_AWS_COST_EXPLORER: value }),
      ).toBe('fake');
    },
  );
});

describe('createLocalCostExplorerAdapter', () => {
  it('returns the synthetic adapter in fake mode', async () => {
    const { createLocalCostExplorerAdapter } = await import('../handlers');
    const adapter = createLocalCostExplorerAdapter('fake');
    expect(adapter).not.toBeInstanceOf(CostExplorerAwsAdapter);
    await expect(adapter.listBillingViews()).resolves.toEqual([
      { arn: 'arn:aws:billing::000000000000:billingview/local-primary', name: 'Local primary' },
      { arn: 'arn:aws:billing::000000000000:billingview/local-team', name: 'Local team' },
    ]);
  });

  it('returns the same adapter class the Lambda uses in real mode', async () => {
    const { createLocalCostExplorerAdapter } = await import('../handlers');
    expect(createLocalCostExplorerAdapter('real')).toBeInstanceOf(CostExplorerAwsAdapter);
  });
});
