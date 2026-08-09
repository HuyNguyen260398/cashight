import { describe, expect, it, vi } from 'vitest';

import type { Statement } from '@cashight/domain/schemas';
import {
  buildWorkspaceMigrationPlan,
  executeWorkspaceMigration,
  formatWorkspaceMigrationReport,
  parseWorkspaceMigrationArgs,
  type WorkspaceMigrationDependencies,
} from '../migrate-workspace-ownership';

const SOURCE_SUB = 'cognito-sub-123';
const SOURCE_KEY =
  'users/cognito-sub-123/statements/9674/2026/2026-05.json';
const DESTINATION_KEY = 'users/primary/statements/9674/2026/2026-05.json';

const statement: Statement = {
  bank: 'TPBank',
  cardLast4: '9674',
  statementDate: '2026-05-01',
  paymentDueDate: '2026-05-25',
  creditLimit: 50_000_000,
  totals: {
    previousBalance: 0,
    statementBalance: 150_000,
    minimumPayment: 7_500,
    totalSpend: 150_000,
    totalInstallments: 0,
    totalCashback: 0,
    totalFeesAndInterest: 0,
  },
  transactions: [
    {
      date: '2026-05-15',
      postingDate: '2026-05-16',
      description: 'PRIVATE DESCRIPTION',
      category: 'food',
      amountVnd: -150_000,
      currency: 'VND',
      originalAmount: 150_000,
      isInstallment: false,
      isInternational: false,
    },
  ],
};

const bytes = Buffer.from(JSON.stringify(statement));
const sourceMetadata = {
  PK: `USER#${SOURCE_SUB}`,
  SK: 'STATEMENT#2026-05#9674',
  statementId: '2026-05-9674',
  objectKey: SOURCE_KEY,
  cardLast4: '9674',
  bank: 'TPBank',
  statementDate: '2026-05-01',
  totalSpend: 150_000,
  transactionCount: 1,
  sha256: 'a'.repeat(64),
  uploadedAt: '2026-06-27T12:00:00.000Z',
};

function makeDependencies(
  overrides: Partial<WorkspaceMigrationDependencies> = {},
): WorkspaceMigrationDependencies {
  const objects = new Map<string, Uint8Array>([[SOURCE_KEY, bytes]]);
  const metadata = new Map<string, unknown>([
    [`USER#${SOURCE_SUB}|STATEMENT#2026-05#9674`, sourceMetadata],
  ]);

  return {
    listObjects: vi.fn().mockResolvedValue([SOURCE_KEY]),
    readObject: vi.fn(async (key: string) => objects.get(key)),
    readMetadata: vi.fn(async (pk: string, sk: string) =>
      metadata.get(`${pk}|${sk}`),
    ),
    copyObject: vi.fn(async (sourceKey: string, destinationKey: string) => {
      const body = objects.get(sourceKey);
      if (!body) throw new Error('missing source');
      objects.set(destinationKey, body);
    }),
    putMetadata: vi.fn(async (record) => {
      metadata.set(`${record.PK}|${record.SK}`, record);
    }),
    ...overrides,
  };
}

describe('parseWorkspaceMigrationArgs', () => {
  it('accepts the exact dry-run form', () => {
    expect(
      parseWorkspaceMigrationArgs([
        '--dry-run',
        '--source-sub',
        SOURCE_SUB,
      ]),
    ).toEqual({ mode: 'dry-run', sourceSub: SOURCE_SUB });
  });

  it('requires the exact apply confirmation', () => {
    expect(() =>
      parseWorkspaceMigrationArgs(['--apply', '--source-sub', SOURCE_SUB]),
    ).toThrow('confirm-copy-to-primary');
    expect(
      parseWorkspaceMigrationArgs([
        '--apply',
        '--source-sub',
        SOURCE_SUB,
        '--confirm-copy-to-primary',
      ]),
    ).toEqual({ mode: 'apply', sourceSub: SOURCE_SUB });
  });

  const invalidArgumentCases: Array<[string[]]> = [
    [[]],
    [['--dry-run', '--apply', '--source-sub', SOURCE_SUB]],
    [['--dry-run', '--source-sub', '../unsafe']],
    [['--dry-run', '--source-sub', SOURCE_SUB, '--delete']],
  ];

  it.each(invalidArgumentCases)(
    'rejects ambiguous, unsafe, or unknown arguments: %j',
    (args) => {
      expect(() => parseWorkspaceMigrationArgs(args)).toThrow();
    },
  );
});

describe('buildWorkspaceMigrationPlan', () => {
  it('returns sorted validated operations without invoking writes', async () => {
    const secondKey =
      'users/cognito-sub-123/statements/1234/2026/2026-04.json';
    const secondStatement = {
      ...statement,
      cardLast4: '1234',
      statementDate: '2026-04-01',
    };
    const deps = makeDependencies({
      listObjects: vi.fn().mockResolvedValue([SOURCE_KEY, secondKey]),
      readObject: vi.fn(async (key: string) =>
        key === SOURCE_KEY
          ? bytes
          : Buffer.from(JSON.stringify(secondStatement)),
      ),
      readMetadata: vi.fn(async (pk: string, sk: string) => ({
        ...sourceMetadata,
        PK: pk,
        SK: sk,
        statementId: sk.includes('2026-04') ? '2026-04-1234' : '2026-05-9674',
        objectKey: sk.includes('2026-04') ? secondKey : SOURCE_KEY,
        cardLast4: sk.includes('2026-04') ? '1234' : '9674',
        statementDate: sk.includes('2026-04') ? '2026-04-01' : '2026-05-01',
      })),
    });

    const plan = await buildWorkspaceMigrationPlan(SOURCE_SUB, deps);

    expect(plan.map((operation) => operation.sourceKey)).toEqual([
      secondKey,
      SOURCE_KEY,
    ]);
    expect(plan[1]).toMatchObject({
      destinationKey: DESTINATION_KEY,
      sourceMetadataKey: {
        PK: `USER#${SOURCE_SUB}`,
        SK: 'STATEMENT#2026-05#9674',
      },
      destinationMetadataKey: {
        PK: 'WORKSPACE#primary',
        SK: 'STATEMENT#2026-05#9674',
      },
      validationStatus: 'VALID',
    });
    expect(plan[1].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(deps.putMetadata).not.toHaveBeenCalled();
  });
});

describe('executeWorkspaceMigration', () => {
  it('performs zero writes in dry-run mode', async () => {
    const deps = makeDependencies();

    const report = await executeWorkspaceMigration(
      { mode: 'dry-run', sourceSub: SOURCE_SUB },
      deps,
    );

    expect(report).toMatchObject({ planned: 1, copied: 0, validated: 1 });
    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(deps.putMetadata).not.toHaveBeenCalled();
  });

  it('copies, writes workspace metadata, and rereads both destinations', async () => {
    const deps = makeDependencies();

    const report = await executeWorkspaceMigration(
      { mode: 'apply', sourceSub: SOURCE_SUB },
      deps,
    );

    expect(report).toMatchObject({
      planned: 1,
      copied: 1,
      alreadyPresent: 0,
      conflicts: 0,
      validated: 1,
    });
    expect(deps.copyObject).toHaveBeenCalledWith(
      SOURCE_KEY,
      DESTINATION_KEY,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(deps.putMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        PK: 'WORKSPACE#primary',
        objectKey: DESTINATION_KEY,
      }),
    );
    expect(deps.readObject).toHaveBeenCalledWith(DESTINATION_KEY);
    expect(deps.readMetadata).toHaveBeenCalledWith(
      'WORKSPACE#primary',
      'STATEMENT#2026-05#9674',
    );
  });

  it('is idempotent when destination object and metadata already match', async () => {
    const initialDeps = makeDependencies();
    await executeWorkspaceMigration(
      { mode: 'apply', sourceSub: SOURCE_SUB },
      initialDeps,
    );
    vi.mocked(initialDeps.copyObject).mockClear();
    vi.mocked(initialDeps.putMetadata).mockClear();

    const report = await executeWorkspaceMigration(
      { mode: 'apply', sourceSub: SOURCE_SUB },
      initialDeps,
    );

    expect(report.alreadyPresent).toBe(1);
    expect(initialDeps.copyObject).not.toHaveBeenCalled();
    expect(initialDeps.putMetadata).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a destination with different content', async () => {
    const deps = makeDependencies({
      readObject: vi.fn(async (key: string) =>
        key === DESTINATION_KEY ? Buffer.from('different') : bytes,
      ),
    });

    const report = await executeWorkspaceMigration(
      { mode: 'apply', sourceSub: SOURCE_SUB },
      deps,
    );

    expect(report.conflicts).toBe(1);
    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(deps.putMetadata).not.toHaveBeenCalled();
  });
});

describe('formatWorkspaceMigrationReport', () => {
  it('redacts the source subject and statement contents', async () => {
    const report = await executeWorkspaceMigration(
      { mode: 'dry-run', sourceSub: SOURCE_SUB },
      makeDependencies(),
    );

    const output = formatWorkspaceMigrationReport(report, SOURCE_SUB);

    expect(output).not.toContain(SOURCE_SUB);
    expect(output).not.toContain('PRIVATE DESCRIPTION');
    expect(output).toContain('users/[source-sub]/statements/');
  });
});
