import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

// LOCAL_DATA_DIR is read on every call, but set it before importing anyway so
// nothing can touch the developer's real .local-data during the suite.
let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cashight-local-'));
  process.env.LOCAL_DATA_DIR = dataDir;
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  delete process.env.LOCAL_DATA_DIR;
});

beforeEach(async () => {
  await fs.rm(path.join(dataDir, 'table.json'), { force: true });
});

const {
  applyUpdateExpression,
  createLocalDynamoClient,
  evaluateCondition,
} = await import('../dynamo');
const {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} = await import('@aws-sdk/lib-dynamodb');

const TABLE = 'cashight-local';

describe('evaluateCondition', () => {
  it('handles attribute_exists / attribute_not_exists', () => {
    const item = { PK: 'JOB#1', SK: 'METADATA' };
    expect(evaluateCondition('attribute_exists(PK)', item, {}, {})).toBe(true);
    expect(evaluateCondition('attribute_exists(PK)', undefined, {}, {})).toBe(false);
    expect(evaluateCondition('attribute_not_exists(PK)', undefined, {}, {})).toBe(true);
    expect(evaluateCondition('attribute_not_exists(PK)', item, {}, {})).toBe(false);
  });

  it('resolves aliased names and value placeholders, ANDed together', () => {
    const item = { PK: 'JOB#1', SK: 'METADATA', state: 'PENDING_UPLOAD' };
    const names = { '#state': 'state' };
    const check = (from: string) =>
      evaluateCondition(
        'attribute_exists(PK) AND #state = :from',
        item,
        names,
        { ':from': from },
      );
    expect(check('PENDING_UPLOAD')).toBe(true);
    expect(check('PROCESSING')).toBe(false);
  });

  it('rejects expression forms it cannot faithfully evaluate', () => {
    expect(() => evaluateCondition('size(PK) > :n', undefined, {}, { ':n': 1 })).toThrow(
      /Unsupported ConditionExpression/,
    );
  });
});

describe('applyUpdateExpression', () => {
  const item = { PK: 'AUTHZ#u', SK: 'PROFILE', createdAt: 'first' };

  it('applies SET assignments and preserves if_not_exists values', () => {
    const updated = applyUpdateExpression(
      'SET active = :active, createdAt = if_not_exists(createdAt, :createdAt), updatedAt = :updatedAt',
      item,
      {},
      { ':active': true, ':createdAt': 'second', ':updatedAt': 'now' },
    );
    expect(updated).toEqual({
      PK: 'AUTHZ#u',
      SK: 'PROFILE',
      active: true,
      createdAt: 'first', // if_not_exists did not clobber it
      updatedAt: 'now',
    });
  });

  it('uses the if_not_exists fallback when the attribute is absent', () => {
    const updated = applyUpdateExpression(
      'SET createdAt = if_not_exists(createdAt, :createdAt)',
      { PK: 'AUTHZ#u', SK: 'PROFILE' },
      {},
      { ':createdAt': 'second' },
    );
    expect(updated.createdAt).toBe('second');
  });

  it('rejects non-SET update expressions', () => {
    expect(() => applyUpdateExpression('REMOVE foo', item, {}, {})).toThrow(
      /only SET is supported/,
    );
  });
});

describe('local DynamoDB client', () => {
  const client = createLocalDynamoClient();

  it('round-trips items through the JSON file', async () => {
    await client.send(
      new PutCommand({ TableName: TABLE, Item: { PK: 'A', SK: 'B', n: 1 } }),
    );
    const got = await client.send(
      new GetCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'B' } }),
    );
    expect(got.Item).toEqual({ PK: 'A', SK: 'B', n: 1 });

    const raw = JSON.parse(await fs.readFile(path.join(dataDir, 'table.json'), 'utf8'));
    expect(raw.items).toEqual([{ PK: 'A', SK: 'B', n: 1 }]);
  });

  it('drops undefined attributes, matching removeUndefinedValues', async () => {
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: 'A', SK: 'B', kept: 1, dropped: undefined },
      }),
    );
    const got = await client.send(
      new GetCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'B' } }),
    );
    expect(got.Item).toEqual({ PK: 'A', SK: 'B', kept: 1 });
  });

  it('enforces attribute_not_exists on Put — the idempotency guarantee', async () => {
    const put = () =>
      client.send(
        new PutCommand({
          TableName: TABLE,
          Item: { PK: 'JOB#1', SK: 'CHECKSUM#abc' },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    await expect(put()).resolves.toBeDefined();
    await expect(put()).rejects.toBeInstanceOf(ConditionalCheckFailedException);
  });

  it('enforces the state guard on Update — the job state machine', async () => {
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: 'JOB#1', SK: 'METADATA', state: 'PENDING_UPLOAD' },
      }),
    );

    const transition = (from: string, to: string) =>
      client.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: 'JOB#1', SK: 'METADATA' },
          ConditionExpression: 'attribute_exists(PK) AND #state = :from',
          UpdateExpression: 'SET #state = :to',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: { ':from': from, ':to': to },
        }),
      );

    await expect(transition('PENDING_UPLOAD', 'PROCESSING')).resolves.toBeDefined();
    // Replaying the same transition must fail — this is what makes a duplicate
    // SQS delivery a no-op rather than a double parse.
    await expect(transition('PENDING_UPLOAD', 'PROCESSING')).rejects.toBeInstanceOf(
      ConditionalCheckFailedException,
    );
  });

  it('serializes concurrent conditional writes so only one wins', async () => {
    const attempts = Array.from({ length: 5 }, () =>
      client
        .send(
          new PutCommand({
            TableName: TABLE,
            Item: { PK: 'JOB#race', SK: 'CHECKSUM#x' },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        )
        .then(() => 'won' as const)
        .catch(() => 'lost' as const),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'won')).toHaveLength(1);
  });

  it('queries a partition with begins_with, ordering and paginating by SK', async () => {
    for (const sk of ['STATEMENT#2026-01#9674', 'STATEMENT#2026-02#9674', 'OTHER#1']) {
      await client.send(
        new PutCommand({ TableName: TABLE, Item: { PK: 'USER#u', SK: sk } }),
      );
    }
    await client.send(
      new PutCommand({ TableName: TABLE, Item: { PK: 'USER#other', SK: 'STATEMENT#2026-01#1111' } }),
    );

    const descending = await client.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': 'USER#u', ':prefix': 'STATEMENT#' },
        ScanIndexForward: false,
      }),
    );
    expect(descending.Items?.map((i) => i.SK)).toEqual([
      'STATEMENT#2026-02#9674',
      'STATEMENT#2026-01#9674',
    ]);
    expect(descending.LastEvaluatedKey).toBeUndefined();

    const firstPage = await client.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': 'USER#u', ':prefix': 'STATEMENT#' },
        Limit: 1,
      }),
    );
    expect(firstPage.Items?.map((i) => i.SK)).toEqual(['STATEMENT#2026-01#9674']);
    expect(firstPage.LastEvaluatedKey).toEqual({
      PK: 'USER#u',
      SK: 'STATEMENT#2026-01#9674',
    });

    const secondPage = await client.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': 'USER#u', ':prefix': 'STATEMENT#' },
        Limit: 1,
        ExclusiveStartKey: firstPage.LastEvaluatedKey,
      }),
    );
    expect(secondPage.Items?.map((i) => i.SK)).toEqual(['STATEMENT#2026-02#9674']);
    expect(secondPage.LastEvaluatedKey).toBeUndefined();
  });

  it('deletes by key and tolerates deleting a missing item', async () => {
    await client.send(new PutCommand({ TableName: TABLE, Item: { PK: 'A', SK: 'B' } }));
    await client.send(new DeleteCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'B' } }));
    await client.send(new DeleteCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'B' } }));
    const got = await client.send(
      new GetCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'B' } }),
    );
    expect(got.Item).toBeUndefined();
  });
});
