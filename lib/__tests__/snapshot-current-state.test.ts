import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import {
  buildStateSnapshot,
  resolveSnapshotOutputPath,
} from '@/scripts/snapshot-current-state';

function statement(
  description: string,
  totalSpend: number,
  statementDate: string,
): string {
  return JSON.stringify({
    bank: 'TPBank',
    cardLast4: '1111',
    statementDate,
    paymentDueDate: '2026-06-15',
    creditLimit: 100_000_000,
    totals: {
      previousBalance: 0,
      statementBalance: totalSpend,
      minimumPayment: 0,
      totalSpend,
      totalInstallments: 0,
      totalCashback: 0,
      totalFeesAndInterest: 0,
    },
    transactions: [
      {
        date: `${statementDate.slice(0, 7)}-10`,
        postingDate: `${statementDate.slice(0, 7)}-11`,
        description,
        currency: 'VND',
        originalAmount: totalSpend,
        amountVnd: totalSpend,
        category: 'Shopping',
        isInstallment: false,
        isInternational: false,
      },
    ],
  });
}

describe('resolveSnapshotOutputPath', () => {
  it('accepts files under .migration-private', () => {
    expect(
      resolveSnapshotOutputPath(
        '.migration-private/current-state.json',
        '/workspace/cashight',
      ),
    ).toBe(
      path.join('/workspace/cashight', '.migration-private/current-state.json'),
    );
  });

  it.each([
    'current-state.json',
    '../current-state.json',
    '.migration-private/../current-state.json',
    '.migration-private',
  ])('rejects output outside a file below .migration-private: %s', (output) => {
    expect(() => resolveSnapshotOutputPath(output, '/workspace/cashight')).toThrow(
      'Snapshot output must be a file under .migration-private/',
    );
  });
});

describe('buildStateSnapshot', () => {
  it('paginates, validates statements, and returns metadata without transactions', async () => {
    const firstBody = statement(
      'FIRST PRIVATE DESCRIPTION',
      1_000_000,
      '2026-05-31',
    );
    const secondBody = statement(
      'SECOND PRIVATE DESCRIPTION',
      2_000_000,
      '2026-06-30',
    );
    const bodies = new Map([
      ['statements/1111/2026/2026-05.json', firstBody],
      ['statements/1111/2026/2026-06.json', secondBody],
    ]);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetBucketVersioningCommand) {
        return { Status: 'Enabled' };
      }
      if (command instanceof ListObjectsV2Command) {
        if (!command.input.ContinuationToken) {
          return {
            Contents: [{ Key: 'statements/1111/2026/2026-05.json' }],
            IsTruncated: true,
            NextContinuationToken: 'next-page',
          };
        }
        return {
          Contents: [{ Key: 'statements/1111/2026/2026-06.json' }],
          IsTruncated: false,
        };
      }
      if (command instanceof GetObjectCommand) {
        const body = bodies.get(command.input.Key ?? '');
        if (!body) throw new Error('Unexpected object key');
        return {
          Body: {
            transformToByteArray: async () => Buffer.from(body),
          },
        };
      }
      throw new Error('Unexpected command');
    });

    const snapshot = await buildStateSnapshot({
      bucket: 'cashight-statements',
      s3: { send } as unknown as S3Client,
      now: () => new Date('2026-06-27T12:00:00.000Z'),
    });

    expect(snapshot).toEqual({
      generatedAt: '2026-06-27T12:00:00.000Z',
      bucket: 'cashight-statements',
      objectCount: 2,
      versioningStatus: 'Enabled',
      statements: [
        {
          key: 'statements/1111/2026/2026-05.json',
          cardLast4: '1111',
          statementDate: '2026-05-31',
          totalSpend: 1_000_000,
          transactionCount: 1,
          sha256: createHash('sha256').update(firstBody).digest('hex'),
        },
        {
          key: 'statements/1111/2026/2026-06.json',
          cardLast4: '1111',
          statementDate: '2026-06-30',
          totalSpend: 2_000_000,
          transactionCount: 1,
          sha256: createHash('sha256').update(secondBody).digest('hex'),
        },
      ],
    });
    expect(send).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(snapshot).includes('PRIVATE DESCRIPTION')).toBe(false);
  });
});
