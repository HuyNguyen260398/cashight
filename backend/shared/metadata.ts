import {
  GetCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
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
