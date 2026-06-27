import { GetObjectCommand } from '@aws-sdk/client-s3';
import { aggregate } from '@cashight/domain/aggregations';
import { parsePeriodFromSearch } from '@cashight/domain/period';
import { StatementSchema } from '@cashight/domain/schemas';
import type { Statement } from '@cashight/domain/schemas';
import type { AggregatedView } from '@cashight/domain/aggregations';

import { ApiError, errorResponse, jsonResponse, type ApiResponse } from '../../shared/api-response';
import { authorizeRequest } from '../../shared/auth-claims';
import { dynamoDocumentClient, s3Client } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  getAuthorizedUser,
  queryUserStatementsForYear,
  type StatementMetadataRecord,
} from '../../shared/metadata';

const MAX_CONCURRENCY = 5;

export interface DashboardApiDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  queryStatementsForYear: (sub: string, year: number) => Promise<StatementMetadataRecord[]>;
  getStatementObject: (objectKey: string) => Promise<Statement>;
}

async function fetchConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<Statement>,
  concurrency: number,
): Promise<Statement[]> {
  const results: Statement[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map(fn));
    results.push(...settled);
  }
  return results;
}

function buildSearchParams(event: unknown): URLSearchParams {
  const qs = (event as { queryStringParameters?: Record<string, string> | null })
    .queryStringParameters ?? {};
  return new URLSearchParams(qs as Record<string, string>);
}

export function createDashboardApiHandler(deps: DashboardApiDependencies) {
  return async (event: unknown): Promise<ApiResponse> => {
    const requestId =
      (event as { requestContext?: { requestId?: string } }).requestContext?.requestId ??
      'unknown';

    try {
      const { claims } = await authorizeRequest(event, 'cashight/read', {
        getAuthorizedUser: deps.getAuthorizedUser,
      });
      const sub = claims.sub;

      const searchParams = buildSearchParams(event);
      const spec = parsePeriodFromSearch(searchParams);

      // Query all metadata for the period's year then filter to the period
      const allMeta = await deps.queryStatementsForYear(sub, spec.year);

      // Fetch matching S3 objects with bounded concurrency
      const statements = await fetchConcurrent(
        allMeta,
        (meta) => deps.getStatementObject(meta.objectKey),
        MAX_CONCURRENCY,
      );

      const view: AggregatedView = aggregate(statements, spec);

      return jsonResponse(200, view);
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

async function defaultGetStatementObject(bucket: string, objectKey: string): Promise<Statement> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  const body = await res.Body?.transformToByteArray();
  if (!body) throw new ApiError('DATA_INTEGRITY_ERROR', 500, 'Empty S3 object.');
  const text = Buffer.from(body).toString('utf8');
  return StatementSchema.parse(JSON.parse(text));
}

export async function handler(event: unknown): Promise<ApiResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const statementBucket = requiredEnvironmentValue('STATEMENTS_BUCKET');
  const dashboardHandler = createDashboardApiHandler({
    getAuthorizedUser: (sub) => getAuthorizedUser(dynamoDocumentClient, tableName, sub),
    queryStatementsForYear: (sub, year) =>
      queryUserStatementsForYear(dynamoDocumentClient, tableName, sub, year),
    getStatementObject: (objectKey) =>
      defaultGetStatementObject(statementBucket, objectKey),
  });
  return dashboardHandler(event);
}
