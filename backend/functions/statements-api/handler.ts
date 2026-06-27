import { DeleteObjectCommand, GetObjectCommand, S3ServiceException } from '@aws-sdk/client-s3';
import type { Statement } from '@cashight/domain/schemas';
import { z } from 'zod';

import { ApiError, errorResponse, jsonResponse, type ApiResponse } from '../../shared/api-response';
import { authorizeRequest } from '../../shared/auth-claims';
import { dynamoDocumentClient, s3Client } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  deleteStatementMetadata,
  getAuthorizedUser,
  getStatementMetadataById,
  queryUserStatements,
  type StatementMetadataRecord,
} from '../../shared/metadata';
import { parseStatementObject } from '../../shared/storage';

const STATEMENT_ID_SCHEMA = z.string().regex(/^\d{4}-\d{2}-\d{4}$/);

const cursorSchema = z.object({
  PK: z.string(),
  SK: z.string(),
});

export interface StatementsApiDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  queryStatements: (
    sub: string,
    cursor: Record<string, unknown> | null,
    limit?: number,
  ) => Promise<{ items: StatementMetadataRecord[]; nextCursor: Record<string, unknown> | null }>;
  getStatementMetadata: (sub: string, statementId: string) => Promise<StatementMetadataRecord | undefined>;
  getStatementObject: (objectKey: string) => Promise<Statement>;
  deleteStatementObject: (objectKey: string) => Promise<void>;
  deleteStatementMetadata: (sub: string, statementId: string) => Promise<void>;
}

function parseCursor(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = cursorSchema.parse(JSON.parse(decoded));
    return parsed;
  } catch {
    throw new ApiError('INVALID_REQUEST', 400, 'Invalid cursor value.');
  }
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

function metaToSummary(record: StatementMetadataRecord) {
  return {
    statementId: record.statementId,
    cardLast4: record.cardLast4,
    statementDate: record.statementDate,
    totalSpend: record.totalSpend,
    transactionCount: record.transactionCount,
    uploadedAt: record.uploadedAt,
  };
}

function getQueryParam(event: unknown, name: string): string | undefined {
  const qs = (event as { queryStringParameters?: Record<string, string> | null })
    .queryStringParameters;
  return qs?.[name];
}

function getPathParam(event: unknown, name: string): string | undefined {
  const pp = (event as { pathParameters?: Record<string, string> | null }).pathParameters;
  return pp?.[name];
}

function getMethod(event: unknown): string {
  return (event as { httpMethod?: string }).httpMethod?.toUpperCase() ?? 'GET';
}

export function createStatementsApiHandler(deps: StatementsApiDependencies) {
  return async (event: unknown): Promise<ApiResponse> => {
    const requestId =
      (event as { requestContext?: { requestId?: string } }).requestContext?.requestId ??
      'unknown';

    try {
      const { claims } = await authorizeRequest(event, 'cashight/read', {
        getAuthorizedUser: deps.getAuthorizedUser,
      });
      const sub = claims.sub;
      const method = getMethod(event);
      const statementIdParam = getPathParam(event, 'statementId');

      if (!statementIdParam) {
        // List endpoint
        const rawCursor = getQueryParam(event, 'cursor');
        const cursor = parseCursor(rawCursor);
        const { items, nextCursor } = await deps.queryStatements(sub, cursor);
        return jsonResponse(200, {
          statements: items.map(metaToSummary),
          nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
        });
      }

      // Validate statementId to prevent traversal
      if (!STATEMENT_ID_SCHEMA.safeParse(statementIdParam).success) {
        throw new ApiError('INVALID_REQUEST', 400, 'Invalid statementId format.');
      }

      const record = await deps.getStatementMetadata(sub, statementIdParam);
      if (!record) {
        throw new ApiError('NOT_FOUND', 404, 'Statement not found.');
      }
      if (record.PK !== `USER#${sub}`) {
        throw new ApiError('FORBIDDEN', 403, 'Access denied.');
      }

      if (method === 'DELETE') {
        await deps.deleteStatementObject(record.objectKey);
        await deps.deleteStatementMetadata(sub, statementIdParam);
        return jsonResponse(200, { statementId: statementIdParam, deleted: true });
      }

      // GET single statement
      const statement = await deps.getStatementObject(record.objectKey);
      return jsonResponse(200, { statement });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

async function defaultGetStatementObject(bucket: string, objectKey: string): Promise<Statement> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  const body = await res.Body?.transformToByteArray();
  if (!body) throw new ApiError('DATA_INTEGRITY_ERROR', 500, 'Empty S3 object.');
  return parseStatementObject(body);
}

async function defaultDeleteStatementObject(bucket: string, objectKey: string): Promise<void> {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  } catch (err) {
    if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return;
    throw err;
  }
}

export async function handler(event: unknown): Promise<ApiResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const statementBucket = requiredEnvironmentValue('STATEMENTS_BUCKET');
  const statementsHandler = createStatementsApiHandler({
    getAuthorizedUser: (sub) => getAuthorizedUser(dynamoDocumentClient, tableName, sub),
    queryStatements: (sub, cursor, limit) =>
      queryUserStatements(dynamoDocumentClient, tableName, sub, cursor, limit),
    getStatementMetadata: (sub, statementId) =>
      getStatementMetadataById(dynamoDocumentClient, tableName, sub, statementId),
    getStatementObject: (objectKey) =>
      defaultGetStatementObject(statementBucket, objectKey),
    deleteStatementObject: (objectKey) =>
      defaultDeleteStatementObject(statementBucket, objectKey),
    deleteStatementMetadata: (sub, statementId) =>
      deleteStatementMetadata(dynamoDocumentClient, tableName, sub, statementId),
  });
  return statementsHandler(event);
}
