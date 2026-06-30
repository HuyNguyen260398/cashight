import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildMigrationPlan,
  executeMigration,
  type MigrationDependencies,
  type MigrationOptions,
  type MigrationReport,
} from '../migrate-statements';

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Realistic Cognito sub (UUID, not email)
const SUB = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const TABLE = 'cashight-table';
const BUCKET = 'cashight-statements';

function makeStatementBytes(
  cardLast4 = '9674',
  year = 2026,
  month = 5,
): Buffer {
  const mm = String(month).padStart(2, '0');
  const statement = {
    bank: 'TPBank',
    cardLast4,
    statementDate: `${year}-${mm}-01`,
    paymentDueDate: `${year}-${mm}-15`,
    creditLimit: 50000000,
    transactions: [],
    totals: {
      previousBalance: 0,
      statementBalance: 1000,
      minimumPayment: 100,
      totalSpend: 1000,
      totalInstallments: 0,
      totalCashback: 0,
      totalFeesAndInterest: 0,
    },
  };
  return Buffer.from(JSON.stringify(statement), 'utf8');
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function legacyKey(cardLast4: string, year: number, month: number): string {
  return `statements/${cardLast4}/${year}/${year}-${String(month).padStart(2, '0')}.json`;
}

function newKey(sub: string, cardLast4: string, year: number, month: number): string {
  return `users/${sub}/statements/${cardLast4}/${year}/${year}-${String(month).padStart(2, '0')}.json`;
}

// ── Mock deps factory ─────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<MigrationDependencies> = {}): MigrationDependencies {
  const bytes9674 = makeStatementBytes('9674', 2026, 5);

  return {
    listSourceObjects: vi.fn().mockResolvedValue([
      { key: legacyKey('9674', 2026, 5), size: bytes9674.length },
    ]),
    getObject: vi.fn().mockResolvedValue(bytes9674),
    headObject: vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { name: 'NoSuchKey' })),
    copyObject: vi.fn().mockResolvedValue(undefined),
    getAuthzRecord: vi.fn().mockResolvedValue({
      PK: `AUTHZ#${SUB}`,
      SK: 'PROFILE',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    putStatementMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildMigrationPlan', () => {
  it('lists all source objects and derives destination keys', async () => {
    const deps = makeDeps();
    const plan = await buildMigrationPlan(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      deps,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].sourceKey).toBe(legacyKey('9674', 2026, 5));
    expect(plan[0].destKey).toBe(newKey(SUB, '9674', 2026, 5));
  });

  it('handles pagination over 1000 keys', async () => {
    // listSourceObjects handles S3 pagination internally and returns all items.
    const allObjects = Array.from({ length: 1001 }, (_, i) => ({
      key: legacyKey('9674', 2024 + Math.floor(i / 12), (i % 12) + 1),
      size: 100,
    }));

    const deps = makeDeps({
      listSourceObjects: vi.fn().mockResolvedValue(allObjects),
    });

    const plan = await buildMigrationPlan(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      deps,
    );
    expect(plan).toHaveLength(1001);
  });
});

describe('executeMigration — dry run', () => {
  it('produces a report without writing anything', async () => {
    const deps = makeDeps();
    const opts: MigrationOptions = { dryRun: true };
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      opts,
      deps,
    );

    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(deps.putStatementMetadata).not.toHaveBeenCalled();
    expect(report.mode).toBe('dry-run');
    expect(report.planned).toBe(1);
    expect(report.copied).toBe(0);
    expect(report.skipped).toBe(0); // would-copy doesn't count as skipped
    expect(report.errors).toHaveLength(0);
  });

  it('dry-run report includes destination key without writing it', async () => {
    const deps = makeDeps();
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: true },
      deps,
    );
    expect(report.entries[0].destKey).toBe(newKey(SUB, '9674', 2026, 5));
    expect(report.entries[0].outcome).toBe('would-copy');
  });
});

describe('executeMigration — authorization gate', () => {
  it('aborts before any S3 write when AUTHZ record is absent', async () => {
    const deps = makeDeps({
      getAuthzRecord: vi.fn().mockResolvedValue(undefined),
    });
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );

    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(deps.putStatementMetadata).not.toHaveBeenCalled();
    expect(report.abortReason).toMatch(/authorization/i);
    expect(report.planned).toBe(0);
  });

  it('aborts when AUTHZ record exists but active is false', async () => {
    const deps = makeDeps({
      getAuthzRecord: vi.fn().mockResolvedValue({
        PK: `AUTHZ#${SUB}`,
        SK: 'PROFILE',
        active: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );

    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(report.abortReason).toMatch(/authorization/i);
  });
});

describe('executeMigration — invalid source object', () => {
  it('records an error and skips the invalid object without aborting', async () => {
    const invalidBytes = Buffer.from('not json', 'utf8');
    const deps = makeDeps({
      getObject: vi.fn().mockResolvedValue(invalidBytes),
    });
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );

    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].key).toBe(legacyKey('9674', 2026, 5));
    expect(report.errors[0].reason).toMatch(/invalid/i);
    expect(report.skipped).toBe(1);
  });
});

describe('executeMigration — idempotency', () => {
  it('skips an object whose destination already has the same SHA-256', async () => {
    const bytes = makeStatementBytes('9674', 2026, 5);
    const checksum = sha256(bytes);
    const deps = makeDeps({
      getObject: vi.fn().mockResolvedValue(bytes),
      headObject: vi.fn().mockResolvedValue({ sha256: checksum }),
    });
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );

    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(report.skipped).toBe(1);
    expect(report.entries[0].outcome).toBe('already-migrated');
  });

  it('records a conflict when destination exists with a different SHA-256', async () => {
    const deps = makeDeps({
      headObject: vi.fn().mockResolvedValue({ sha256: 'deadbeef'.repeat(8) }),
    });
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );

    expect(deps.copyObject).not.toHaveBeenCalled();
    expect(report.conflicts).toBe(1);
    expect(report.entries[0].outcome).toBe('conflict');
  });
});

describe('executeMigration — apply mode', () => {
  it('copies object and writes DynamoDB metadata on success', async () => {
    const deps = makeDeps();
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );

    expect(deps.copyObject).toHaveBeenCalledOnce();
    expect(deps.putStatementMetadata).toHaveBeenCalledOnce();
    expect(report.copied).toBe(1);
    expect(report.errors).toHaveLength(0);
    expect(report.entries[0].outcome).toBe('copied');
  });

  it('writes metadata with the correct DynamoDB key shape', async () => {
    const deps = makeDeps();
    await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );

    const [, record] = (deps.putStatementMetadata as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(record).toMatchObject({
      PK: `USER#${SUB}`,
      SK: 'STATEMENT#2026-05#9674',
      statementId: '2026-05-9674',
      objectKey: newKey(SUB, '9674', 2026, 5),
      cardLast4: '9674',
    });
  });

  it('interrupted rerun is idempotent — already-copied objects are skipped', async () => {
    const bytes = makeStatementBytes('9674', 2026, 5);
    const checksum = sha256(bytes);
    const deps = makeDeps({
      getObject: vi.fn().mockResolvedValue(bytes),
      // First call: destination absent → copy. Second call: destination present same SHA.
      headObject: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }))
        .mockResolvedValueOnce({ sha256: checksum }),
    });

    const report1 = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );
    const report2 = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: false },
      deps,
    );

    expect(report1.copied).toBe(1);
    expect(report2.copied).toBe(0);
    expect(report2.skipped).toBe(1);
    expect(report2.entries[0].outcome).toBe('already-migrated');
  });
});

describe('report redaction', () => {
  it('report entries do not contain email addresses', async () => {
    const deps = makeDeps();
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: true },
      deps,
    );
    const serialized = JSON.stringify(report);
    // sub may appear (it's an identifier, not PII in this context)
    // but raw email form should not appear in entry descriptions
    expect(serialized).not.toMatch(/user@example\.com/);
  });

  it('report entries do not contain transaction descriptions', async () => {
    const bytesWithTxn = Buffer.from(
      JSON.stringify({
        cardLast4: '9674',
        statementDate: '2026-05-01',
        transactions: [
          {
            date: '2026-05-01',
            postingDate: '2026-05-02',
            description: 'SECRET_MERCHANT_NAME_XYZ',
            currency: 'VND',
            originalAmount: 100000,
            amountVnd: -100000,
            category: 'Food',
            isInstallment: false,
            isInternational: false,
          },
        ],
        totals: {
          previousBalance: 0,
          statementBalance: 100000,
          minimumPayment: 10000,
          totalSpend: 100000,
          totalInstallments: 0,
          totalCashback: 0,
          totalFeesAndInterest: 0,
        },
      }),
      'utf8',
    );
    const deps = makeDeps({ getObject: vi.fn().mockResolvedValue(bytesWithTxn) });
    const report = await executeMigration(
      { sub: SUB, sourcePrefix: 'statements/', bucket: BUCKET, tableName: TABLE },
      { dryRun: true },
      deps,
    );
    expect(JSON.stringify(report)).not.toContain('SECRET_MERCHANT_NAME_XYZ');
  });
});
