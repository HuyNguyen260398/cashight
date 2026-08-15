import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';

import {
  assertAwsInvoiceRecordOwner,
  deleteAwsInvoiceMetadata,
  getAwsInvoiceMetadata,
  getAwsInvoiceUploadJobRecord,
  parseAwsInvoiceMetadataRecord,
  putAwsInvoiceMetadata,
  putAwsInvoiceUploadJobRecord,
  queryAwsInvoiceMetadata,
  transitionAwsInvoiceJobState,
  type AwsInvoiceMetadataRecord,
  type AwsInvoiceUploadJobRecord,
} from '../shared/metadata';
import { awsInvoiceObjectKey, parseAwsInvoiceObject } from '../shared/storage';

type Command = { constructor: { name: string }; input: Record<string, unknown> };

class RecordingClient {
  readonly commands: Command[] = [];
  responses: Array<Record<string, unknown>> = [];

  async send(command: Command): Promise<Record<string, unknown>> {
    this.commands.push(command);
    return ['GetCommand', 'QueryCommand'].includes(command.constructor.name)
      ? (this.responses.shift() ?? {})
      : {};
  }
}

const metadata: AwsInvoiceMetadataRecord = {
  PK: 'WORKSPACE#primary',
  SK: 'AWS_INVOICE#2026-07',
  yearMonth: '2026-07',
  objectKey: 'users/primary/aws-invoices/2026/2026-07.json',
  currency: 'USD',
  amountDue: 110,
  tax: 10,
  serviceCount: 2,
  linkedAccountCount: 1,
  sha256: 'a'.repeat(64),
  parserId: 'aws-inc-consolidated-usd',
  parserVersion: 1,
  uploadedAt: '2026-08-03T00:00:00.000Z',
};

const job: AwsInvoiceUploadJobRecord = {
  PK: 'JOB#8193504f-8e42-43a4-b780-061601a02572',
  SK: 'METADATA',
  documentType: 'AWS_INVOICE',
  owner: { workspaceId: 'primary', subject: 'user-123' },
  state: 'PENDING_UPLOAD',
  sha256: 'b'.repeat(64),
  force: false,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  expiresAtEpoch: 1_786_000_000,
};

describe('AWS invoice storage ownership', () => {
  it('derives a validated workspace/month object key', () => {
    expect(awsInvoiceObjectKey('primary', 2026, 7)).toBe(
      'users/primary/aws-invoices/2026/2026-07.json',
    );
    expect(() => awsInvoiceObjectKey('other' as 'primary', 2026, 7)).toThrow();
    expect(() => awsInvoiceObjectKey('primary', 2026, 0)).toThrow();
    expect(() => awsInvoiceObjectKey('primary', 2026, 13)).toThrow();
  });

  it('validates invoice JSON at the storage boundary', () => {
    expect(() => parseAwsInvoiceObject(JSON.stringify({ nope: true }))).toThrowError(
      'Invalid AWS invoice object',
    );
    expect(() => parseAwsInvoiceObject('{broken')).toThrowError(
      'Invalid AWS invoice object',
    );
  });

  it('rejects foreign partitions and foreign or traversal-like object keys', () => {
    expect(() => assertAwsInvoiceRecordOwner('primary', metadata)).not.toThrow();
    expect(() =>
      assertAwsInvoiceRecordOwner('primary', {
        ...metadata,
        PK: 'WORKSPACE#other',
      }),
    ).toThrowError('Access denied.');
    expect(() =>
      assertAwsInvoiceRecordOwner('primary', {
        ...metadata,
        objectKey: 'users/primary/aws-invoices/../../private.json',
      }),
    ).toThrowError('Access denied.');
  });
});

describe('AWS invoice DynamoDB metadata', () => {
  it('strictly validates stored metadata', () => {
    expect(parseAwsInvoiceMetadataRecord(metadata)).toEqual(metadata);
    expect(() =>
      parseAwsInvoiceMetadataRecord({ ...metadata, accountId: '123456789012' }),
    ).toThrowError('Invalid AWS invoice metadata record');
  });

  it('puts metadata with an ownership condition', async () => {
    const client = new RecordingClient();

    await putAwsInvoiceMetadata(
      client as unknown as DynamoDBDocumentClient,
      'table',
      metadata,
    );

    expect(client.commands[0].constructor.name).toBe('PutCommand');
    expect(client.commands[0].input).toMatchObject({
        TableName: 'table',
        Item: metadata,
        ConditionExpression: 'attribute_not_exists(PK) OR PK = :pk',
        ExpressionAttributeValues: { ':pk': 'WORKSPACE#primary' },
    });
  });

  it('gets one record consistently using a validated month key', async () => {
    const client = new RecordingClient();
    client.responses.push({ Item: metadata });

    await expect(
      getAwsInvoiceMetadata(
        client as unknown as DynamoDBDocumentClient,
        'table',
        'primary',
        '2026-07',
      ),
    ).resolves.toEqual(metadata);
    expect(client.commands[0].input).toMatchObject({
      Key: { PK: 'WORKSPACE#primary', SK: 'AWS_INVOICE#2026-07' },
      ConsistentRead: true,
    });
    await expect(
      getAwsInvoiceMetadata(
        client as unknown as DynamoDBDocumentClient,
        'table',
        'primary',
        '../2026-07',
      ),
    ).rejects.toThrow();
  });

  it('queries history newest-first with a bounded cursor and limit', async () => {
    const client = new RecordingClient();
    const cursor = { PK: 'WORKSPACE#primary', SK: 'AWS_INVOICE#2026-06' };
    client.responses.push({ Items: [metadata], LastEvaluatedKey: cursor });

    await expect(
      queryAwsInvoiceMetadata(
        client as unknown as DynamoDBDocumentClient,
        'table',
        'primary',
        cursor,
        25,
      ),
    ).resolves.toEqual({ items: [metadata], nextCursor: cursor });
    expect(client.commands[0].input).toMatchObject({
      ExpressionAttributeValues: {
        ':pk': 'WORKSPACE#primary',
        ':prefix': 'AWS_INVOICE#',
      },
      ExclusiveStartKey: cursor,
      Limit: 25,
      ScanIndexForward: false,
    });
  });

  it('deletes metadata with an exact ownership condition', async () => {
    const client = new RecordingClient();

    await deleteAwsInvoiceMetadata(
      client as unknown as DynamoDBDocumentClient,
      'table',
      'primary',
      '2026-07',
    );

    expect(client.commands[0].constructor.name).toBe('DeleteCommand');
    expect(client.commands[0].input).toMatchObject({
        Key: { PK: 'WORKSPACE#primary', SK: 'AWS_INVOICE#2026-07' },
        ConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'WORKSPACE#primary' },
    });
  });
});

describe('typed AWS invoice upload jobs', () => {
  it('puts and consistently reads an exact invoice job record', async () => {
    const client = new RecordingClient();
    client.responses.push({ Item: job });

    await putAwsInvoiceUploadJobRecord(
      client as unknown as DynamoDBDocumentClient,
      'table',
      job,
    );
    await expect(
      getAwsInvoiceUploadJobRecord(
        client as unknown as DynamoDBDocumentClient,
        'table',
        '8193504f-8e42-43a4-b780-061601a02572',
      ),
    ).resolves.toEqual(job);
    expect(client.commands[1].input).toMatchObject({ ConsistentRead: true });
  });

  it('transitions a job with a typed month-only conflict', async () => {
    const client = new RecordingClient();

    await expect(
      transitionAwsInvoiceJobState(
        client as unknown as DynamoDBDocumentClient,
        'table',
        '8193504f-8e42-43a4-b780-061601a02572',
        'PROCESSING',
        'CONFLICT',
        '2026-08-03T00:01:00.000Z',
        {
          errorCode: 'INVOICE_CONFLICT',
          conflict: { year: 2026, month: 7 },
        },
      ),
    ).resolves.toBe('ok');
    expect(client.commands[0].input).toMatchObject({
      ConditionExpression:
        'attribute_exists(PK) AND documentType = :documentType AND #state = :from',
      ExpressionAttributeValues: {
        ':documentType': 'AWS_INVOICE',
        ':from': 'PROCESSING',
        ':to': 'CONFLICT',
        ':conflict': { year: 2026, month: 7 },
      },
    });
  });
});
