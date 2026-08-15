import { GetObjectCommand } from '@aws-sdk/client-s3';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { aggregate } from '@cashight/domain/aggregations';
import { parseBankFromSearch } from '@cashight/domain/banks';
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
  assertLegacyRecordOwner,
  assertRecordOwner,
  queryUserStatementsForYear,
  queryWorkspaceStatementsForYear,
  type StatementMetadataRecord,
} from '../../shared/metadata';
import { metrics } from '../../shared/observability';

const MAX_CONCURRENCY = 5;

export interface DashboardApiDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  queryStatementsForYear: (workspaceId: 'primary', year: number) => Promise<StatementMetadataRecord[]>;
  queryLegacyStatementsForYear: (sub: string, year: number) => Promise<StatementMetadataRecord[]>;
  getStatementObject: (objectKey: string) => Promise<Statement>;
  enableLegacyWorkspaceFallback?: boolean;
  onLegacyFallback?: () => void;
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
      const { claims, authorization } = await authorizeRequest(event, 'cashight/read', {
        getAuthorizedUser: deps.getAuthorizedUser,
      });

      const searchParams = buildSearchParams(event);
      const spec = parsePeriodFromSearch(searchParams);
      const bank = parseBankFromSearch(searchParams);

      // Query all metadata for the period's year then filter to the period
      let allMeta = await deps.queryStatementsForYear(
        authorization.workspaceId,
        spec.year,
      );
      let legacy = false;
      if (allMeta.length === 0 && deps.enableLegacyWorkspaceFallback) {
        allMeta = await deps.queryLegacyStatementsForYear(claims.sub, spec.year);
        legacy = allMeta.length > 0;
        if (legacy) deps.onLegacyFallback?.();
      }

      for (const meta of allMeta) {
        if (legacy) assertLegacyRecordOwner(claims.sub, meta);
        else assertRecordOwner(authorization.workspaceId, meta);
      }

      // Fetch matching S3 objects with bounded concurrency
      const statements = await fetchConcurrent(
        allMeta,
        (meta) => deps.getStatementObject(meta.objectKey),
        MAX_CONCURRENCY,
      );

      const view: AggregatedView = aggregate(statements, spec, { bank });

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
      queryWorkspaceStatementsForYear(dynamoDocumentClient, tableName, sub, year),
    queryLegacyStatementsForYear: (sub, year) =>
      queryUserStatementsForYear(dynamoDocumentClient, tableName, sub, year),
    getStatementObject: (objectKey) =>
      defaultGetStatementObject(statementBucket, objectKey),
    enableLegacyWorkspaceFallback:
      process.env.ENABLE_LEGACY_WORKSPACE_FALLBACK === 'true',
    onLegacyFallback: () => {
      metrics.addMetric('LegacyWorkspaceFallback', MetricUnit.Count, 1);
    },
  });
  return dashboardHandler(event);
}
