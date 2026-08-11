import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { UploadJobState } from '@cashight/domain/api';
import {
  AwsInvoiceErrorCodeSchema,
  AwsInvoiceMetadataSchema,
  AwsInvoiceUploadJobStateSchema,
  YearMonthSchema,
  type AwsInvoiceErrorCode,
  type AwsInvoiceMetadata,
  type AwsInvoiceUploadJobState,
  type YearMonth,
} from '@cashight/domain/aws-invoices';
import { BANK_CODES, type BankCode } from '@cashight/domain/banks';
import {
  AuthorizedWorkspaceSchema,
  type AuthorizedWorkspace,
  type WorkspaceId,
} from '@cashight/domain/workspace';
import { z } from 'zod';

import { ApiError } from './api-response';
import { awsInvoiceObjectKey, workspacePartition } from './storage';

export interface AuthorizedUserRecord extends AuthorizedWorkspace {
  PK: `AUTHZ#${string}`;
  SK: 'PROFILE';
  active: true;
  createdAt: string;
  updatedAt: string;
}

export interface StatementMetadataRecord {
  PK: `WORKSPACE#${string}` | `USER#${string}`;
  SK: `STATEMENT#${string}#${string}`;
  statementId: string;
  objectKey: string;
  cardLast4: string;
  /** Absent on records written before multi-bank support — read as 'TPBank'. */
  bank?: BankCode;
  statementDate: string;
  totalSpend: number;
  transactionCount: number;
  sha256: string;
  uploadedAt: string;
}

export interface AwsInvoiceMetadataRecord extends AwsInvoiceMetadata {
  PK: 'WORKSPACE#primary';
  SK: `AWS_INVOICE#${YearMonth}`;
}

export interface AwsInvoiceUploadJobRecord {
  PK: `JOB#${string}`;
  SK: 'METADATA';
  documentType: 'AWS_INVOICE';
  owner: { workspaceId: WorkspaceId; subject: string };
  state: AwsInvoiceUploadJobState;
  sha256: string;
  force: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAtEpoch: number;
  errorCode?: AwsInvoiceErrorCode;
  yearMonth?: YearMonth;
  conflict?: { year: number; month: number };
  processingClaimId?: string;
}

export interface CostQueryCacheManifestRecord {
  PK: `WORKSPACE#${string}`;
  SK: `AWS_QUERY_CACHE#${string}#MANIFEST`;
  recordType: 'AWS_QUERY_CACHE_MANIFEST';
  schemaVersion: 1;
  chunkCount: number;
  payloadSha256: string;
  asOf: string;
  publishedAtEpoch: number;
  expiresAtEpoch: number;
}

export interface CostQueryCacheChunkRecord {
  PK: `WORKSPACE#${string}`;
  SK: `AWS_QUERY_CACHE#${string}#CHUNK#${string}`;
  recordType: 'AWS_QUERY_CACHE_CHUNK';
  schemaVersion: 1;
  chunkIndex: number;
  payload: string;
  expiresAtEpoch: number;
}

export function costQueryCachePrefix(
  digest: string,
): `AWS_QUERY_CACHE#${string}#` {
  return `AWS_QUERY_CACHE#${digest}#`;
}

export function costQueryCacheManifestKey(
  digest: string,
): `AWS_QUERY_CACHE#${string}#MANIFEST` {
  return `${costQueryCachePrefix(digest)}MANIFEST`;
}

export function costQueryCacheChunkKey(
  digest: string,
  index: number,
): `AWS_QUERY_CACHE#${string}#CHUNK#${string}` {
  return `${costQueryCachePrefix(digest)}CHUNK#${String(index).padStart(6, '0')}`;
}

const authorizationRecordSchema = z.object({
  PK: z.string().regex(/^AUTHZ#[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  SK: z.literal('PROFILE'),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).extend(AuthorizedWorkspaceSchema.shape);

const legacyAuthorizationRecordSchema = z.object({
  PK: z.string().regex(/^AUTHZ#[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  SK: z.literal('PROFILE'),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const statementMetadataRecordSchema = z.object({
  PK: z.string().regex(/^(?:WORKSPACE#primary|USER#[A-Za-z0-9][A-Za-z0-9._:-]*)$/),
  SK: z.string().regex(/^STATEMENT#\d{4}-\d{2}#\d{4}$/),
  statementId: z.string().regex(/^\d{4}-\d{2}-\d{4}$/),
  objectKey: z.string().min(1),
  cardLast4: z.string().regex(/^\d{4}$/),
  bank: z.enum(BANK_CODES).optional(),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalSpend: z.number(),
  transactionCount: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uploadedAt: z.string().datetime(),
});

const awsInvoiceMetadataRecordSchema = AwsInvoiceMetadataSchema.extend({
  PK: z.literal('WORKSPACE#primary'),
  SK: z.string().regex(/^AWS_INVOICE#\d{4}-(0[1-9]|1[0-2])$/),
}).superRefine((record, context) => {
  if (record.SK !== `AWS_INVOICE#${record.yearMonth}`) {
    context.addIssue({
      code: 'custom',
      path: ['SK'],
      message: 'Invoice metadata month keys must agree',
    });
  }
});

const awsInvoiceUploadJobRecordSchema = z
  .object({
    PK: z.string().regex(/^JOB#[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    SK: z.literal('METADATA'),
    documentType: z.literal('AWS_INVOICE'),
    owner: z
      .object({
        workspaceId: z.literal('primary'),
        subject: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
      })
      .strict(),
    state: AwsInvoiceUploadJobStateSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    force: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAtEpoch: z.number().int().positive(),
    errorCode: AwsInvoiceErrorCodeSchema.optional(),
    yearMonth: YearMonthSchema.optional(),
    conflict: z
      .object({
        year: z.number().int().min(1900).max(9999),
        month: z.number().int().min(1).max(12),
      })
      .strict()
      .optional(),
    processingClaimId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
      .optional(),
  })
  .strict();

export function parseAuthorizedUserRecord(
  value: unknown,
): AuthorizedUserRecord | undefined {
  const parsed = authorizationRecordSchema.safeParse(value);
  if (!parsed.success || parsed.data.active !== true) return undefined;
  return parsed.data as AuthorizedUserRecord;
}

export function parseLegacyAuthorizedUserRecord(
  value: unknown,
): Omit<AuthorizedUserRecord, keyof AuthorizedWorkspace> | undefined {
  const parsed = legacyAuthorizationRecordSchema.safeParse(value);
  if (!parsed.success || parsed.data.active !== true) return undefined;
  return parsed.data as Omit<AuthorizedUserRecord, keyof AuthorizedWorkspace>;
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

export function parseAwsInvoiceMetadataRecord(
  value: unknown,
): AwsInvoiceMetadataRecord {
  const parsed = awsInvoiceMetadataRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      'DATA_INTEGRITY_ERROR',
      500,
      'Invalid AWS invoice metadata record',
    );
  }
  return parsed.data as AwsInvoiceMetadataRecord;
}

function parseAwsInvoiceUploadJobRecord(
  value: unknown,
): AwsInvoiceUploadJobRecord {
  const parsed = awsInvoiceUploadJobRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      'DATA_INTEGRITY_ERROR',
      500,
      'Invalid AWS invoice upload job record',
    );
  }
  return parsed.data as AwsInvoiceUploadJobRecord;
}

export function assertAwsInvoiceRecordOwner(
  workspaceId: WorkspaceId,
  record: { PK: string; yearMonth: string; objectKey: string },
): void {
  const parsedMonth = YearMonthSchema.safeParse(record.yearMonth);
  const [yearText, monthText] = parsedMonth.success
    ? parsedMonth.data.split('-')
    : ['', ''];
  const expectedObject = parsedMonth.success
    ? awsInvoiceObjectKey(
        workspaceId,
        Number(yearText),
        Number(monthText),
      )
    : undefined;
  if (
    record.PK !== workspacePartition(workspaceId) ||
    record.objectKey !== expectedObject
  ) {
    throw new ApiError('FORBIDDEN', 403, 'Access denied.');
  }
}

export function assertRecordOwner(
  workspaceId: WorkspaceId,
  record: { PK: string; objectKey?: string },
): void {
  const ownsPartition = record.PK === workspacePartition(workspaceId);
  const ownsObject =
    record.objectKey === undefined ||
    record.objectKey.startsWith(`users/${workspaceId}/statements/`);
  if (!ownsPartition || !ownsObject) {
    throw new ApiError('FORBIDDEN', 403, 'Access denied.');
  }
}

export function assertLegacyRecordOwner(
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

interface UploadJobRecordBase {
  PK: `JOB#${string}`;
  SK: 'METADATA';
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

export type UploadJobRecord = UploadJobRecordBase &
  (
    | {
        owner: { workspaceId: WorkspaceId; subject: string };
        sub?: never;
      }
    | {
        /** Legacy jobs remain readable only during the compatibility window. */
        sub: string;
        owner?: never;
      }
  );

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

export async function putAwsInvoiceMetadata(
  client: DynamoDBDocumentClient,
  tableName: string,
  record: AwsInvoiceMetadataRecord,
): Promise<void> {
  const parsed = parseAwsInvoiceMetadataRecord(record);
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: parsed,
      ConditionExpression: 'attribute_not_exists(PK) OR PK = :pk',
      ExpressionAttributeValues: { ':pk': parsed.PK },
    }),
  );
}

export async function getAwsInvoiceMetadata(
  client: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: WorkspaceId,
  yearMonth: string,
): Promise<AwsInvoiceMetadataRecord | undefined> {
  const safeMonth = YearMonthSchema.parse(yearMonth);
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: workspacePartition(workspaceId),
        SK: `AWS_INVOICE#${safeMonth}`,
      },
      ConsistentRead: true,
    }),
  );
  if (!result.Item) return undefined;
  const record = parseAwsInvoiceMetadataRecord(result.Item);
  assertAwsInvoiceRecordOwner(workspaceId, record);
  return record;
}

export interface AwsInvoiceQueryResult {
  items: AwsInvoiceMetadataRecord[];
  nextCursor: Record<string, unknown> | null;
}

const awsInvoiceCursorSchema = z
  .object({
    PK: z.literal('WORKSPACE#primary'),
    SK: z.string().regex(/^AWS_INVOICE#\d{4}-(0[1-9]|1[0-2])$/),
  })
  .strict();

export async function queryAwsInvoiceMetadata(
  client: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: WorkspaceId,
  cursor: Record<string, unknown> | null,
  limit = 50,
): Promise<AwsInvoiceQueryResult> {
  const safeCursor = cursor ? awsInvoiceCursorSchema.parse(cursor) : undefined;
  const safeLimit = z.number().int().min(1).max(100).parse(limit);
  const partition = workspacePartition(workspaceId);
  if (safeCursor && safeCursor.PK !== partition) {
    throw new ApiError('FORBIDDEN', 403, 'Access denied.');
  }
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': partition,
        ':prefix': 'AWS_INVOICE#',
      },
      Limit: safeLimit,
      ExclusiveStartKey: safeCursor,
      ScanIndexForward: false,
    }),
  );
  const items = (result.Items ?? []).map((item) => {
    const record = parseAwsInvoiceMetadataRecord(item);
    assertAwsInvoiceRecordOwner(workspaceId, record);
    return record;
  });
  return {
    items,
    nextCursor: result.LastEvaluatedKey ?? null,
  };
}

export async function deleteAwsInvoiceMetadata(
  client: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: WorkspaceId,
  yearMonth: string,
): Promise<void> {
  const safeMonth = YearMonthSchema.parse(yearMonth);
  const partition = workspacePartition(workspaceId);
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: partition, SK: `AWS_INVOICE#${safeMonth}` },
      ConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': partition },
    }),
  );
}

export async function putAwsInvoiceUploadJobRecord(
  client: DynamoDBDocumentClient,
  tableName: string,
  record: AwsInvoiceUploadJobRecord,
): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: parseAwsInvoiceUploadJobRecord(record),
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
}

export async function getAwsInvoiceUploadJobRecord(
  client: DynamoDBDocumentClient,
  tableName: string,
  jobId: string,
): Promise<AwsInvoiceUploadJobRecord | undefined> {
  const safeJobId = z.string().uuid().parse(jobId);
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `JOB#${safeJobId}`, SK: 'METADATA' },
      ConsistentRead: true,
    }),
  );
  if (!result.Item) return undefined;
  return parseAwsInvoiceUploadJobRecord(result.Item);
}

export async function transitionAwsInvoiceJobState(
  client: DynamoDBDocumentClient,
  tableName: string,
  jobId: string,
  fromState: AwsInvoiceUploadJobState,
  toState: AwsInvoiceUploadJobState,
  updatedAt: string,
  extra: {
    errorCode?: AwsInvoiceErrorCode;
    yearMonth?: YearMonth;
    conflict?: { year: number; month: number };
  } = {},
): Promise<TransitionResult> {
  const safeJobId = z.string().uuid().parse(jobId);
  AwsInvoiceUploadJobStateSchema.parse(fromState);
  AwsInvoiceUploadJobStateSchema.parse(toState);
  z.string().datetime().parse(updatedAt);
  if (extra.errorCode) AwsInvoiceErrorCodeSchema.parse(extra.errorCode);
  if (extra.yearMonth) YearMonthSchema.parse(extra.yearMonth);
  const safeConflict = extra.conflict
    ? z
        .object({
          year: z.number().int().min(1900).max(9999),
          month: z.number().int().min(1).max(12),
        })
        .strict()
        .parse(extra.conflict)
    : undefined;
  const additions = [
    extra.errorCode ? ', errorCode = :errorCode' : '',
    extra.yearMonth ? ', yearMonth = :yearMonth' : '',
    safeConflict ? ', conflict = :conflict' : '',
  ].join('');
  const values: Record<string, unknown> = {};
  if (extra.errorCode) values[':errorCode'] = extra.errorCode;
  if (extra.yearMonth) values[':yearMonth'] = extra.yearMonth;
  if (safeConflict) values[':conflict'] = safeConflict;

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `JOB#${safeJobId}`, SK: 'METADATA' },
        ConditionExpression:
          'attribute_exists(PK) AND documentType = :documentType AND #state = :from',
        UpdateExpression: `SET #state = :to, updatedAt = :updatedAt${additions}`,
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':documentType': 'AWS_INVOICE',
          ':from': fromState,
          ':to': toState,
          ':updatedAt': updatedAt,
          ...values,
        },
      }),
    );
    return 'ok';
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      const current = await getAwsInvoiceUploadJobRecord(
        client,
        tableName,
        safeJobId,
      );
      if (!current) return 'not_found';
      if (['SUCCEEDED', 'CONFLICT', 'FAILED'].includes(current.state)) {
        return 'already_terminal';
      }
      return 'ok';
    }
    throw error;
  }
}

export type AwsInvoiceJobClaimResult =
  | 'claimed'
  | 'resume'
  | 'duplicate'
  | 'already_terminal'
  | 'not_found';

export async function claimAwsInvoiceUploadJob(
  client: DynamoDBDocumentClient,
  tableName: string,
  jobId: string,
  claimId: string,
  updatedAt: string,
): Promise<AwsInvoiceJobClaimResult> {
  const safeJobId = z.string().uuid().parse(jobId);
  const safeClaimId = z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
    .parse(claimId);
  z.string().datetime().parse(updatedAt);
  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `JOB#${safeJobId}`, SK: 'METADATA' },
        ConditionExpression:
          'attribute_exists(PK) AND documentType = :documentType AND #state = :pending',
        UpdateExpression:
          'SET #state = :processing, processingClaimId = :claimId, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':documentType': 'AWS_INVOICE',
          ':pending': 'PENDING_UPLOAD',
          ':processing': 'PROCESSING',
          ':claimId': safeClaimId,
          ':updatedAt': updatedAt,
        },
      }),
    );
    return 'claimed';
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    const current = await getAwsInvoiceUploadJobRecord(
      client,
      tableName,
      safeJobId,
    );
    if (!current) return 'not_found';
    if (['SUCCEEDED', 'CONFLICT', 'FAILED'].includes(current.state)) {
      return 'already_terminal';
    }
    if (
      current.state === 'PROCESSING' &&
      current.processingClaimId === safeClaimId
    ) {
      return 'resume';
    }
    return 'duplicate';
  }
}

export interface StatementQueryResult {
  items: StatementMetadataRecord[];
  nextCursor: Record<string, unknown> | null;
}

export async function queryUserStatements(
  client: DynamoDBDocumentClient,
  tableName: string,
  sub: string,
  cursor: Record<string, unknown> | null,
  limit = 50,
): Promise<StatementQueryResult> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${sub}`,
        ':prefix': 'STATEMENT#',
      },
      Limit: limit,
      ExclusiveStartKey: cursor ?? undefined,
      ScanIndexForward: false,
    }),
  );
  return {
    items: (result.Items ?? []) as StatementMetadataRecord[],
    nextCursor: result.LastEvaluatedKey ?? null,
  };
}

export async function queryWorkspaceStatements(
  client: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: WorkspaceId,
  cursor: Record<string, unknown> | null,
  limit = 50,
): Promise<StatementQueryResult> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': workspacePartition(workspaceId),
        ':prefix': 'STATEMENT#',
      },
      Limit: limit,
      ExclusiveStartKey: cursor ?? undefined,
      ScanIndexForward: false,
    }),
  );
  return {
    items: (result.Items ?? []) as StatementMetadataRecord[],
    nextCursor: result.LastEvaluatedKey ?? null,
  };
}

export async function queryUserStatementsForYear(
  client: DynamoDBDocumentClient,
  tableName: string,
  sub: string,
  year: number,
): Promise<StatementMetadataRecord[]> {
  const mm = `${year}-`;
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${sub}`,
        ':prefix': `STATEMENT#${mm}`,
      },
      ScanIndexForward: true,
    }),
  );
  return (result.Items ?? []) as StatementMetadataRecord[];
}

export async function queryWorkspaceStatementsForYear(
  client: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: WorkspaceId,
  year: number,
): Promise<StatementMetadataRecord[]> {
  const mm = `${year}-`;
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': workspacePartition(workspaceId),
        ':prefix': `STATEMENT#${mm}`,
      },
      ScanIndexForward: true,
    }),
  );
  return (result.Items ?? []) as StatementMetadataRecord[];
}

export async function getStatementMetadataById(
  client: DynamoDBDocumentClient,
  tableName: string,
  sub: string,
  statementId: string,
): Promise<StatementMetadataRecord | undefined> {
  // statementId format: ${year}-${mm}-${cardLast4}, SK format: STATEMENT#${year}-${mm}#${cardLast4}
  const parts = statementId.match(/^(\d{4}-\d{2})-(\d{4})$/);
  if (!parts) return undefined;
  const sk = `STATEMENT#${parts[1]}#${parts[2]}`;
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${sub}`, SK: sk },
      ConsistentRead: true,
    }),
  );
  if (!result.Item) return undefined;
  return result.Item as StatementMetadataRecord;
}

export async function getWorkspaceStatementMetadataById(
  client: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: WorkspaceId,
  statementId: string,
): Promise<StatementMetadataRecord | undefined> {
  const parts = statementId.match(/^(\d{4}-\d{2})-(\d{4})$/);
  if (!parts) return undefined;
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: workspacePartition(workspaceId),
        SK: `STATEMENT#${parts[1]}#${parts[2]}`,
      },
      ConsistentRead: true,
    }),
  );
  if (!result.Item) return undefined;
  return result.Item as StatementMetadataRecord;
}

export async function deleteStatementMetadata(
  client: DynamoDBDocumentClient,
  tableName: string,
  sub: string,
  statementId: string,
): Promise<void> {
  const parts = statementId.match(/^(\d{4}-\d{2})-(\d{4})$/);
  if (!parts) return;
  const sk = `STATEMENT#${parts[1]}#${parts[2]}`;
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: `USER#${sub}`, SK: sk },
    }),
  );
}

export async function deleteWorkspaceStatementMetadata(
  client: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: WorkspaceId,
  statementId: string,
): Promise<void> {
  const parts = statementId.match(/^(\d{4}-\d{2})-(\d{4})$/);
  if (!parts) return;
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: workspacePartition(workspaceId),
        SK: `STATEMENT#${parts[1]}#${parts[2]}`,
      },
    }),
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
        'SET active = :active, workspaceId = :workspaceId, authProvider = :authProvider, createdAt = if_not_exists(createdAt, :createdAt), updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':active': true,
        ':workspaceId': record.workspaceId,
        ':authProvider': record.authProvider,
        ':createdAt': record.createdAt,
        ':updatedAt': record.updatedAt,
      },
    }),
  );
}
