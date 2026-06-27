import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { UploadJobState } from '@cashight/domain/api';
import { z } from 'zod';

import { ApiError } from './api-response';

export interface AuthorizedUserRecord {
  PK: `AUTHZ#${string}`;
  SK: 'PROFILE';
  active: true;
  createdAt: string;
  updatedAt: string;
}

export interface StatementMetadataRecord {
  PK: `USER#${string}`;
  SK: `STATEMENT#${string}#${string}`;
  statementId: string;
  objectKey: string;
  cardLast4: string;
  statementDate: string;
  totalSpend: number;
  transactionCount: number;
  sha256: string;
  uploadedAt: string;
}

const authorizationRecordSchema = z.object({
  PK: z.string().regex(/^AUTHZ#[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  SK: z.literal('PROFILE'),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const statementMetadataRecordSchema = z.object({
  PK: z.string().regex(/^USER#[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  SK: z.string().regex(/^STATEMENT#\d{4}-\d{2}#\d{4}$/),
  statementId: z.string().regex(/^\d{4}-\d{2}-\d{4}$/),
  objectKey: z.string().min(1),
  cardLast4: z.string().regex(/^\d{4}$/),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalSpend: z.number(),
  transactionCount: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uploadedAt: z.string().datetime(),
});

export function parseAuthorizedUserRecord(
  value: unknown,
): AuthorizedUserRecord | undefined {
  const parsed = authorizationRecordSchema.safeParse(value);
  if (!parsed.success || parsed.data.active !== true) return undefined;
  return parsed.data as AuthorizedUserRecord;
}

export function parseStatementMetadataRecord(
  value: unknown,
): StatementMetadataRecord {
  const parsed = statementMetadataRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      'DATA_INTEGRITY_ERROR',
      500,
      'Invalid statement metadata record',
    );
  }
  return parsed.data as StatementMetadataRecord;
}

export function assertRecordOwner(
  sub: string,
  record: { PK: string; objectKey?: string },
): void {
  const ownsPartition = record.PK === `USER#${sub}`;
  const ownsObject =
    record.objectKey === undefined ||
    record.objectKey.startsWith(`users/${sub}/statements/`);
  if (!ownsPartition || !ownsObject) {
    throw new ApiError('FORBIDDEN', 403, 'Access denied.');
  }
}

export async function getAuthorizedUser(
  client: DynamoDBDocumentClient,
  tableName: string,
  sub: string,
): Promise<unknown> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `AUTHZ#${sub}`, SK: 'PROFILE' },
      ConsistentRead: true,
    }),
  );
  return result.Item;
}

export interface UploadJobRecord {
  PK: `JOB#${string}`;
  SK: 'METADATA';
  sub: string;
  state: UploadJobState;
  sha256: string;
  force: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAtEpoch: number;
  errorCode?: string;
  statementId?: string;
  conflict?: { cardLast4: string; year: number; month: number };
}

export async function putUploadJobRecord(
  client: DynamoDBDocumentClient,
  tableName: string,
  record: UploadJobRecord,
): Promise<void> {
  await client.send(
    new PutCommand({ TableName: tableName, Item: record }),
  );
}

export async function getUploadJobRecord(
  client: DynamoDBDocumentClient,
  tableName: string,
  jobId: string,
): Promise<UploadJobRecord | undefined> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `JOB#${jobId}`, SK: 'METADATA' },
      ConsistentRead: true,
    }),
  );
  if (!result.Item) return undefined;
  return result.Item as UploadJobRecord;
}

export type TransitionResult = 'ok' | 'already_terminal' | 'not_found';

export async function transitionJobState(
  client: DynamoDBDocumentClient,
  tableName: string,
  jobId: string,
  fromState: UploadJobState,
  toState: UploadJobState,
  updatedAt: string,
  extra: {
    errorCode?: string;
    statementId?: string;
    conflict?: { cardLast4: string; year: number; month: number };
  } = {},
): Promise<TransitionResult> {
  const terminal: UploadJobState[] = ['SUCCEEDED', 'CONFLICT', 'FAILED'];
  const extraExpression = [
    extra.errorCode !== undefined ? ', errorCode = :errorCode' : '',
    extra.statementId !== undefined ? ', statementId = :statementId' : '',
    extra.conflict !== undefined ? ', conflict = :conflict' : '',
  ].join('');

  const extraValues: Record<string, unknown> = {};
  if (extra.errorCode !== undefined) extraValues[':errorCode'] = extra.errorCode;
  if (extra.statementId !== undefined) extraValues[':statementId'] = extra.statementId;
  if (extra.conflict !== undefined) extraValues[':conflict'] = extra.conflict;

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `JOB#${jobId}`, SK: 'METADATA' },
        ConditionExpression: 'attribute_exists(PK) AND #state = :from',
        UpdateExpression: `SET #state = :to, updatedAt = :updatedAt${extraExpression}`,
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':from': fromState,
          ':to': toState,
          ':updatedAt': updatedAt,
          ...extraValues,
        },
      }),
    );
    return 'ok';
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const current = await getUploadJobRecord(client, tableName, jobId);
      if (!current) return 'not_found';
      if (terminal.includes(current.state)) return 'already_terminal';
      return 'ok'; // some other state — caller decides
    }
    throw err;
  }
}

export async function putIdempotencyRecord(
  client: DynamoDBDocumentClient,
  tableName: string,
  jobId: string,
  sha256: string,
  expiresAtEpoch: number,
): Promise<boolean> {
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `JOB#${jobId}`,
          SK: `CHECKSUM#${sha256}`,
          expiresAtEpoch,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

export async function putStatementMetadata(
  client: DynamoDBDocumentClient,
  tableName: string,
  record: StatementMetadataRecord,
): Promise<void> {
  await client.send(
    new PutCommand({ TableName: tableName, Item: record }),
  );
}

export async function upsertAuthorizedUser(
  client: DynamoDBDocumentClient,
  tableName: string,
  record: AuthorizedUserRecord,
): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: record.PK, SK: record.SK },
      UpdateExpression:
        'SET active = :active, createdAt = if_not_exists(createdAt, :createdAt), updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':active': true,
        ':createdAt': record.createdAt,
        ':updatedAt': record.updatedAt,
      },
    }),
  );
}
