import { describe, expect, it, vi } from 'vitest';

import { seedAuthorizations, type SeedDeps } from '../v2/seed-authz';

const profile = (sub: string) => ({
  PK: `AUTHZ#${sub}`,
  SK: 'PROFILE',
  active: true,
  workspaceId: 'primary',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

function fakeDeps(items: Record<string, unknown>[]) {
  const scan = vi.fn<SeedDeps['scan']>(async () => items);
  const put = vi.fn<SeedDeps['put']>(async () => {});
  return { deps: { scan, put } satisfies SeedDeps, scan, put };
}

const options = { sourceTable: 'cashight', targetTable: 'cashight-v2', dryRun: false };

describe('seedAuthorizations', () => {
  it('copies every valid AUTHZ profile to the target', async () => {
    const items = [profile('abc'), profile('smoke.client-1')];
    const { deps, scan, put } = fakeDeps(items);

    await expect(seedAuthorizations(deps, options)).resolves.toEqual({ copied: 2, skipped: 0 });
    expect(scan).toHaveBeenCalledWith('cashight');
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledWith('cashight-v2', items[0]);
    expect(put).toHaveBeenCalledWith('cashight-v2', items[1]);
  });

  it('skips items that are not authorization profiles', async () => {
    const { deps, put } = fakeDeps([
      { PK: 'AUTHZ#abc', SK: 'OTHER' },
      { PK: 'AUTHZ#', SK: 'PROFILE' },
    ]);

    await expect(seedAuthorizations(deps, options)).resolves.toEqual({ copied: 0, skipped: 2 });
    expect(put).not.toHaveBeenCalled();
  });

  it('dry run writes nothing', async () => {
    const { deps, put } = fakeDeps([profile('abc')]);

    await expect(seedAuthorizations(deps, { ...options, dryRun: true })).resolves.toEqual({
      copied: 1,
      skipped: 0,
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses to write into the v1 table', async () => {
    const { deps, scan, put } = fakeDeps([profile('abc')]);

    await expect(
      seedAuthorizations(deps, { sourceTable: 'cashight-v2', targetTable: 'cashight', dryRun: false }),
    ).rejects.toThrow('Refusing: target table cashight is the v1 table');
    expect(scan).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses identical source and target', async () => {
    const { deps, scan } = fakeDeps([profile('abc')]);

    await expect(
      seedAuthorizations(deps, { sourceTable: 'cashight-v2', targetTable: 'cashight-v2', dryRun: false }),
    ).rejects.toThrow('Refusing: source and target are the same table');
    expect(scan).not.toHaveBeenCalled();
  });

  it('never writes to the source', async () => {
    const { deps, put } = fakeDeps([profile('a'), profile('b'), { PK: 'AUTHZ#c', SK: 'X' }]);

    await seedAuthorizations(deps, options);
    for (const [table] of put.mock.calls) expect(table).toBe('cashight-v2');
  });
});
