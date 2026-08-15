import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { describe, expect, it, vi } from 'vitest';

import type { CompleteCostExplorerResult } from '../functions/cost-explorer-api/aws-adapter';
import {
  COST_CACHE_CHUNK_BYTES,
  createCostExplorerCache,
  selectCostResultExpiry,
  serializeCostResultChunks,
  type CostCacheMissReason,
} from '../functions/cost-explorer-api/cache';

type Item = { PK: string; SK: string; [key: string]: unknown };
type Command = { constructor: { name: string }; input: Record<string, unknown> };

function conditionalFailure(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({ message: 'condition failed', $metadata: {} });
}

class MemoryDocumentClient {
  readonly items = new Map<string, Item>();
  readonly calls: Command[] = [];

  private key(item: Pick<Item, 'PK' | 'SK'>): string {
    return `${item.PK}|${item.SK}`;
  }

  async send(command: Command): Promise<Record<string, unknown>> {
    this.calls.push(command);
    const input = command.input;
    if (command.constructor.name === 'PutCommand') {
      const incoming = input.Item as Item;
      const existing = this.items.get(this.key(incoming));
      const values = (input.ExpressionAttributeValues ?? {}) as Record<string, number>;
      const condition = input.ConditionExpression as string | undefined;
      const allowed =
        !condition ||
        !existing ||
        (condition.includes('expiresAtEpoch') &&
          Number(existing.expiresAtEpoch) <= values[':now']) ||
        (condition.includes('publishedAtEpoch') &&
          Number(existing.publishedAtEpoch) <= values[':publishedAt']);
      if (!allowed) throw conditionalFailure();
      this.items.set(this.key(incoming), structuredClone(incoming));
      return {};
    }
    if (command.constructor.name === 'QueryCommand') {
      const values = input.ExpressionAttributeValues as Record<string, string>;
      const matches = [...this.items.values()].filter(
        (item) => item.PK === values[':pk'] && item.SK.startsWith(values[':prefix']),
      );
      return { Items: structuredClone(matches) };
    }
    if (command.constructor.name === 'GetCommand') {
      const item = this.items.get(this.key(input.Key as Item));
      return { Item: item ? structuredClone(item) : undefined };
    }
    if (command.constructor.name === 'DeleteCommand') {
      const key = input.Key as Item;
      const existing = this.items.get(this.key(key));
      const values = (input.ExpressionAttributeValues ?? {}) as Record<string, string>;
      if (
        input.ConditionExpression &&
        existing?.ownerRequestId !== values[':requestId']
      ) {
        throw conditionalFailure();
      }
      this.items.delete(this.key(key));
      return {};
    }
    throw new Error(`Unsupported command ${command.constructor.name}`);
  }
}

const request: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-01-01', end: '2026-07-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

function result(rowCount = 1): CompleteCostExplorerResult {
  const breakdown = Array.from({ length: rowCount }, (_, index) => ({
    groupValues: [`service-${index}-${'x'.repeat(480)}`],
    values: ['1.0000000001'],
    total: '1.0000000001',
    estimated: false,
  }));
  return {
    source: 'AWS',
    asOf: '2026-08-03T12:00:00.000Z',
    currencyOrUnit: 'USD',
    estimated: false,
    overview: { total: String(rowCount), average: String(rowCount) },
    periods: [{ start: '2026-06-01', end: '2026-07-01', estimated: false }],
    series: [{ key: 'series-01', label: 'Service', values: ['1'], total: '1' }],
    breakdown,
    comparisonDrivers: [],
    pageCount: 3,
  };
}

function setup(options: {
  now?: Date;
  onCacheMiss?: (reason: CostCacheMissReason) => void;
  sleep?: (milliseconds: number) => Promise<void>;
} = {}) {
  const client = new MemoryDocumentClient();
  const cache = createCostExplorerCache({
    client,
    tableName: 'cashight-test',
    now: () => options.now ?? new Date('2026-08-09T12:00:00.000Z'),
    onCacheMiss: options.onCacheMiss,
    sleep: options.sleep,
    random: () => 0,
  });
  return { cache, client };
}

describe('Cost Explorer cache chunks', () => {
  it('splits UTF-8 without exceeding 300 KiB and round-trips exactly', () => {
    const value = result(1_500);
    value.breakdown = value.breakdown.map((row, index) => ({
      ...row,
      groupValues: [`dịch-vụ-${index}-${'đ'.repeat(230)}`],
    }));
    const chunks = serializeCostResultChunks(value);

    expect(chunks.length).toBeGreaterThan(2);
    expect(
      chunks.every(
        (chunk) => new TextEncoder().encode(chunk).byteLength <= COST_CACHE_CHUNK_BYTES,
      ),
    ).toBe(true);
    expect(JSON.parse(chunks.join(''))).toEqual(value);
  });

  it('writes deterministic chunks first and publishes the manifest last', async () => {
    const { cache, client } = setup();

    await cache.putCachedCostResult('primary', 'a'.repeat(64), result(1_500), 2_000_000_000);

    const writtenKeys = client.calls
      .filter((call) => call.constructor.name === 'PutCommand')
      .map((call) => (call.input.Item as Item).SK);
    expect(writtenKeys[0]).toMatch(/#CHUNK#000001$/);
    expect(writtenKeys.at(-1)).toMatch(/#MANIFEST$/);
    expect(writtenKeys.slice(0, -1)).toEqual(
      writtenKeys.slice(0, -1).map((_, index) =>
        `AWS_QUERY_CACHE#${'a'.repeat(64)}#CHUNK#${String(index + 1).padStart(6, '0')}`,
      ),
    );
  });

  it('returns the exact complete result as a cache-sourced response', async () => {
    const { cache } = setup();
    const value = result(600);
    await cache.putCachedCostResult('primary', 'b'.repeat(64), value, 2_000_000_000);

    await expect(
      cache.getCachedCostResult(
        'primary',
        'b'.repeat(64),
        new Date('2026-08-09T12:00:00.000Z'),
      ),
    ).resolves.toEqual({ ...value, source: 'CACHE' });
  });

  it.each([
    ['missing chunk', 'CHUNK_COUNT'],
    ['extra chunk', 'CHUNK_COUNT'],
    ['expired manifest', 'EXPIRED'],
    ['hash mismatch', 'HASH_MISMATCH'],
    ['invalid chunk', 'CHUNK_INVALID'],
    ['invalid payload', 'PAYLOAD_INVALID'],
  ] as const)('treats %s as a cache miss', async (scenario, expectedReason) => {
    const onCacheMiss = vi.fn();
    const { cache, client } = setup({ onCacheMiss });
    const digest = 'c'.repeat(64);
    await cache.putCachedCostResult('primary', digest, result(600), 2_000_000_000);
    const records = [...client.items.values()];
    const manifest = records.find((item) => item.SK.endsWith('#MANIFEST'))!;
    const chunk = records.find((item) => item.SK.includes('#CHUNK#'))!;

    if (scenario === 'missing chunk') client.items.delete(`${chunk.PK}|${chunk.SK}`);
    if (scenario === 'extra chunk') {
      const extra = { ...chunk, SK: `AWS_QUERY_CACHE#${digest}#CHUNK#999999` };
      client.items.set(`${extra.PK}|${extra.SK}`, extra);
    }
    if (scenario === 'expired manifest') manifest.expiresAtEpoch = 1;
    if (scenario === 'hash mismatch') manifest.payloadSha256 = 'd'.repeat(64);
    if (scenario === 'invalid chunk') chunk.chunkIndex = 99;
    if (scenario === 'invalid payload') {
      chunk.payload = '{';
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('{'));
      manifest.payloadSha256 = [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      manifest.chunkCount = 1;
      for (const record of records.filter(
        (item) => item.SK.includes('#CHUNK#') && item.SK !== chunk.SK,
      )) {
        client.items.delete(`${record.PK}|${record.SK}`);
      }
    }

    await expect(
      cache.getCachedCostResult('primary', digest, new Date('2026-08-09T12:00:00.000Z')),
    ).resolves.toBeUndefined();
    expect(onCacheMiss).toHaveBeenLastCalledWith(expectedReason);
  });
});

describe('Cost Explorer TTL selection', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');

  it('uses one hour for current-period data', () => {
    expect(
      selectCostResultExpiry(
        { ...request, timePeriod: { start: '2026-08-01', end: '2026-09-01' } },
        now,
      ),
    ).toBe(Math.floor(now.getTime() / 1_000) + 3_600);
  });

  it('uses 24 hours for historical data', () => {
    expect(selectCostResultExpiry(request, now)).toBe(
      Math.floor(now.getTime() / 1_000) + 86_400,
    );
  });
});

describe('Cost Explorer distributed claims', () => {
  it('allows one query owner and takeover only after the stored lock expires', async () => {
    const { cache } = setup();
    const digest = 'e'.repeat(64);
    const start = new Date('2026-08-09T12:00:00.000Z');

    await expect(
      cache.claimQueryExecution('primary', digest, 'request-1', start),
    ).resolves.toBe('owner');
    await expect(
      cache.claimQueryExecution('primary', digest, 'request-2', start),
    ).resolves.toBe('wait');
    await expect(
      cache.claimQueryExecution(
        'primary',
        digest,
        'request-2',
        new Date(start.getTime() + 36_000),
      ),
    ).resolves.toBe('owner');
  });

  it('releases only the lock owned by the matching request', async () => {
    const { cache } = setup();
    const digest = 'f'.repeat(64);
    const now = new Date('2026-08-09T12:00:00.000Z');
    await cache.claimQueryExecution('primary', digest, 'request-1', now);

    await cache.releaseQueryExecution('primary', digest, 'request-2');
    await expect(
      cache.claimQueryExecution('primary', digest, 'request-3', now),
    ).resolves.toBe('wait');
    await cache.releaseQueryExecution('primary', digest, 'request-1');
    await expect(
      cache.claimQueryExecution('primary', digest, 'request-3', now),
    ).resolves.toBe('owner');
  });

  it('permits one manual refresh claim per five minutes', async () => {
    const { cache } = setup();
    const digest = '1'.repeat(64);
    const now = new Date('2026-08-09T12:00:00.000Z');

    await expect(cache.claimManualRefresh('primary', digest, now)).resolves.toBe(true);
    await expect(cache.claimManualRefresh('primary', digest, now)).resolves.toBe(false);
    await expect(cache.getManualRefreshCooldown('primary', digest)).resolves.toBe(
      Math.floor(now.getTime() / 1_000) + 300,
    );
    await expect(
      cache.claimManualRefresh(
        'primary',
        digest,
        new Date(now.getTime() + 300_001),
      ),
    ).resolves.toBe(true);
  });

  it('polls until a query owner publishes a complete manifest', async () => {
    const client = new MemoryDocumentClient();
    const sleep = vi.fn<() => Promise<void>>();
    const cache = createCostExplorerCache({
      client,
      tableName: 'cashight-test',
      now: () => new Date('2026-08-09T12:00:00.000Z'),
      sleep,
      random: () => 0,
    });
    sleep.mockImplementationOnce(async () => {
      await cache.putCachedCostResult('primary', '2'.repeat(64), result(), 2_000_000_000);
    });

    await expect(
      cache.waitForCachedCostResult('primary', '2'.repeat(64)),
    ).resolves.toMatchObject({ source: 'CACHE' });
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('stops cache polling at the 20-second wait budget', async () => {
    const sleep = vi.fn(async (milliseconds: number) => {
      void milliseconds;
    });
    const { cache } = setup({ sleep });

    await expect(
      cache.waitForCachedCostResult('primary', '3'.repeat(64)),
    ).resolves.toBeUndefined();
    expect(
      sleep.mock.calls.reduce((total, [milliseconds]) => total + milliseconds, 0),
    ).toBe(20_000);
  });
});
