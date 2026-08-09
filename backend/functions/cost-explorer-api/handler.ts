import {
  CostDimensionRequestSchema,
  CostExplorerReportRequestSchema,
  type CostDimensionRequest,
  type CostExplorerReportRequest,
  type SavedCostReport,
} from '@cashight/domain/aws-cost-explorer';
import {
  costExplorerQueryDigest,
  validateCostExplorerSemantics,
} from '@cashight/domain/aws-cost-canonical';
import type { WorkspaceId } from '@cashight/domain/workspace';
import { z } from 'zod';

import {
  ApiError,
  errorResponse,
  jsonResponse,
  type ApiResponse,
} from '../../shared/api-response';
import { authorizeRequest, type RequiredScope } from '../../shared/auth-claims';
import { dynamoDocumentClient, s3Client } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import { createCostExplorerClients } from '../../shared/cost-explorer-clients';
import { getAuthorizedUser } from '../../shared/metadata';
import {
  CostExplorerAdapterError,
  CostExplorerAwsAdapter,
  type BillingViewSummary,
  type CompleteCostExplorerResult,
  type CostComparisonResult,
  type CostDimensionValue,
  type CostForecastResult,
} from './aws-adapter';
import {
  createCostExplorerCache,
  selectCostResultExpiry,
} from './cache';
import { createCostCsvExporter, type CostCsvExportResponse } from './csv';
import {
  createSavedCostReportStore,
  SavedReportError,
} from './reports';

const QueryBodySchema = z
  .object({
    request: CostExplorerReportRequestSchema,
    refresh: z.boolean().optional().default(false),
  })
  .strict();

const ReportBodySchema = z
  .object({
    reportId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    request: CostExplorerReportRequestSchema,
  })
  .strict();

const BillingViewsRequestSchema = z.object({ type: z.literal('BILLING_VIEW') }).strict();
const DimensionsBodySchema = z.union([
  CostDimensionRequestSchema,
  BillingViewsRequestSchema,
]);
const ReportIdSchema = z.string().uuid();
const DimensionCursorSchema = z
  .object({ version: z.literal(1), offset: z.number().int().nonnegative() })
  .strict();
const DIMENSION_PAGE_SIZE = 50;

interface CostExplorerOperations {
  query(request: CostExplorerReportRequest): Promise<CompleteCostExplorerResult>;
  forecast(request: CostExplorerReportRequest): Promise<CostForecastResult>;
  compare(request: CostExplorerReportRequest): Promise<CostComparisonResult>;
  listValues(request: CostDimensionRequest): Promise<CostDimensionValue[]>;
  listBillingViews(): Promise<BillingViewSummary[]>;
}

interface CostExplorerCacheOperations {
  getCachedCostResult(
    workspaceId: WorkspaceId,
    digest: string,
    now: Date,
  ): Promise<CompleteCostExplorerResult | undefined>;
  putCachedCostResult(
    workspaceId: WorkspaceId,
    digest: string,
    result: CompleteCostExplorerResult,
    expiresAtEpoch: number,
  ): Promise<void>;
  claimManualRefresh(
    workspaceId: WorkspaceId,
    digest: string,
    now: Date,
  ): Promise<boolean>;
  getManualRefreshCooldown(
    workspaceId: WorkspaceId,
    digest: string,
  ): Promise<number | undefined>;
  claimQueryExecution(
    workspaceId: WorkspaceId,
    digest: string,
    requestId: string,
    now: Date,
  ): Promise<'owner' | 'wait'>;
  releaseQueryExecution(
    workspaceId: WorkspaceId,
    digest: string,
    requestId: string,
  ): Promise<void>;
  waitForCachedCostResult(
    workspaceId: WorkspaceId,
    digest: string,
  ): Promise<CompleteCostExplorerResult | undefined>;
}

interface SavedReportOperations {
  listSavedReports(workspaceId: WorkspaceId): Promise<SavedCostReport[]>;
  putSavedReport(
    workspaceId: WorkspaceId,
    input: {
      reportId?: string;
      name: string;
      request: CostExplorerReportRequest;
    },
  ): Promise<SavedCostReport>;
  deleteSavedReport(workspaceId: WorkspaceId, reportId: string): Promise<boolean>;
}

interface CostExporterOperations {
  exportCsv(
    workspaceId: WorkspaceId,
    digest: string,
    result: CompleteCostExplorerResult,
    request: CostExplorerReportRequest,
  ): Promise<CostCsvExportResponse>;
}

export interface CostExplorerApiDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  createAwsAdapter: () => CostExplorerOperations;
  cache: CostExplorerCacheOperations;
  reports: SavedReportOperations;
  exporter: CostExporterOperations;
  granularDataEnabled: boolean;
  now?: () => Date;
  queryDigest?: (request: CostExplorerReportRequest) => Promise<string>;
}

type Operation =
  | 'QUERY'
  | 'COMPARISONS'
  | 'DIMENSIONS'
  | 'FORECAST'
  | 'EXPORT'
  | 'LIST_REPORTS'
  | 'PUT_REPORT'
  | 'DELETE_REPORT';

interface Route {
  operation: Operation;
  scope: RequiredScope;
  reportId?: string;
}

interface QueryExecution {
  digest: string;
  result: CompleteCostExplorerResult;
  refreshCooldownUntil?: string;
}

function getMethod(event: unknown): string {
  return (event as { httpMethod?: string }).httpMethod?.toUpperCase() ?? 'GET';
}

function getPath(event: unknown): string {
  const path = (event as { path?: unknown }).path;
  return typeof path === 'string' ? path : '';
}

function requestIdFrom(event: unknown): string {
  const requestId = (event as { requestContext?: { requestId?: unknown } })
    .requestContext?.requestId;
  return typeof requestId === 'string' && requestId ? requestId : 'unknown';
}

function resolveRoute(event: unknown): Route {
  const method = getMethod(event);
  const segments = getPath(event).split('/').filter(Boolean);
  if (segments[0] !== 'aws' || segments[1] !== 'cost-explorer') {
    throw new ApiError('NOT_FOUND', 404, 'Cost Explorer route not found.');
  }

  const resource = segments[2];
  const reportId = segments[3];
  if (!resource || segments.length > 4 || (resource !== 'reports' && reportId)) {
    throw new ApiError('NOT_FOUND', 404, 'Cost Explorer route not found.');
  }

  if (resource === 'reports') {
    if (reportId) {
      if (method !== 'DELETE') {
        throw new ApiError('METHOD_NOT_ALLOWED', 405, 'Method not allowed.');
      }
      return { operation: 'DELETE_REPORT', scope: 'cashight/write', reportId };
    }
    if (method === 'GET') return { operation: 'LIST_REPORTS', scope: 'cashight/read' };
    if (method === 'POST') return { operation: 'PUT_REPORT', scope: 'cashight/write' };
    throw new ApiError('METHOD_NOT_ALLOWED', 405, 'Method not allowed.');
  }

  const operations: Record<string, Operation> = {
    query: 'QUERY',
    comparisons: 'COMPARISONS',
    dimensions: 'DIMENSIONS',
    forecast: 'FORECAST',
    export: 'EXPORT',
  };
  const operation = operations[resource];
  if (!operation) {
    throw new ApiError('NOT_FOUND', 404, 'Cost Explorer route not found.');
  }
  if (method !== 'POST') {
    throw new ApiError('METHOD_NOT_ALLOWED', 405, 'Method not allowed.');
  }
  return { operation, scope: 'cashight/read' };
}

function rawBody(event: unknown): unknown {
  const body = (event as { body?: unknown }).body;
  if (typeof body !== 'string' || !body) {
    throw new ApiError('INVALID_COST_QUERY', 400, 'The Cost Explorer request is invalid.');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError('INVALID_COST_QUERY', 400, 'The Cost Explorer request is invalid.');
  }
}

function parseCostBody<T>(schema: z.ZodType<T>, event: unknown): T {
  const parsed = schema.safeParse(rawBody(event));
  if (!parsed.success) {
    throw new ApiError('INVALID_COST_QUERY', 400, 'The Cost Explorer request is invalid.');
  }
  return parsed.data;
}

function dimensionOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    return DimensionCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    ).offset;
  } catch {
    throw new ApiError('INVALID_COST_QUERY', 400, 'The Cost Explorer request is invalid.');
  }
}

function paginateDimensionValues(
  values: CostDimensionValue[],
  cursor: string | undefined,
) {
  const offset = dimensionOffset(cursor);
  if (offset > values.length) {
    throw new ApiError('INVALID_COST_QUERY', 400, 'The Cost Explorer request is invalid.');
  }
  const items = values.slice(offset, offset + DIMENSION_PAGE_SIZE);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor:
      nextOffset < values.length
        ? Buffer.from(JSON.stringify({ version: 1, offset: nextOffset })).toString('base64url')
        : null,
  };
}

function validateReport(
  request: CostExplorerReportRequest,
  granularDataEnabled: boolean,
  now: Date,
): CostExplorerReportRequest {
  const validation = validateCostExplorerSemantics(request, {
    granularDataEnabled,
    currentDate: now.toISOString().slice(0, 10),
  });
  const issue = validation.issues.find((candidate) => candidate.severity === 'ERROR');
  if (issue) {
    const statusCode = issue.code === 'GRANULARITY_NOT_AVAILABLE' ? 422 : 400;
    throw new ApiError(
      issue.code,
      statusCode,
      issue.code === 'GRANULARITY_NOT_AVAILABLE'
        ? 'The selected Cost Explorer granularity is unavailable.'
        : 'The Cost Explorer query is invalid.',
    );
  }
  return request;
}

function assertMode(
  request: CostExplorerReportRequest,
  expected: 'QUERY' | 'COMPARISONS',
): void {
  const valid = expected === 'COMPARISONS'
    ? request.mode === 'COMPARISON'
    : request.mode !== 'COMPARISON';
  if (!valid) {
    throw new ApiError('INVALID_COST_QUERY', 400, 'The Cost Explorer query is invalid.');
  }
}

function cooldownIso(epoch: number | undefined): string | undefined {
  if (!Number.isInteger(epoch) || epoch === undefined || epoch < 0) return undefined;
  return new Date(epoch * 1_000).toISOString();
}

function adapterError(error: CostExplorerAdapterError): ApiError {
  const failures = {
    COST_EXPLORER_DISABLED: [424, 'AWS Cost Explorer is not enabled.', false],
    AWS_COST_ACCESS_DENIED: [403, 'The deployment role cannot access AWS cost data.', false],
    AWS_COST_QUERY_BUSY: [503, 'The AWS cost query is already running. Try again shortly.', true],
    AWS_COST_THROTTLED: [503, 'AWS Cost Explorer is temporarily throttling requests.', true],
    GRANULARITY_NOT_AVAILABLE: [422, 'The selected Cost Explorer granularity is unavailable.', false],
    INVALID_COST_QUERY: [400, 'The Cost Explorer query is invalid.', false],
    COGNITO_REAUTH_REQUIRED: [403, 'Sign in with Cognito to access AWS Cost Explorer.', false],
  } as const;
  const [statusCode, message, retryable] = failures[error.code];
  return new ApiError(error.code, statusCode, message, retryable);
}

function savedReportError(error: SavedReportError): ApiError {
  if (error.code === 'DUPLICATE_REPORT_NAME') {
    return new ApiError('DUPLICATE_REPORT_NAME', 409, 'A saved report already uses that name.');
  }
  if (error.code === 'SAVED_REPORT_WRITE_CONFLICT') {
    return new ApiError('SAVED_REPORT_WRITE_CONFLICT', 409, 'The saved report changed. Try again.');
  }
  return new ApiError('INVALID_SAVED_REPORT', 500, 'The saved report could not be read.');
}

function normalizeHandlerError(error: unknown): unknown {
  if (error instanceof CostExplorerAdapterError) return adapterError(error);
  if (error instanceof SavedReportError) return savedReportError(error);
  return error;
}

export function createCostExplorerApiHandler(dependencies: CostExplorerApiDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const queryDigest = dependencies.queryDigest ?? costExplorerQueryDigest;

  async function executeQuery(
    workspaceId: WorkspaceId,
    requestId: string,
    request: CostExplorerReportRequest,
    refresh: boolean,
  ): Promise<QueryExecution> {
    const digest = await queryDigest(request);
    const requestedAt = now();
    const cached = await dependencies.cache.getCachedCostResult(
      workspaceId,
      digest,
      requestedAt,
    );

    if (!refresh && cached) return { digest, result: cached };

    if (refresh) {
      const claimed = await dependencies.cache.claimManualRefresh(
        workspaceId,
        digest,
        requestedAt,
      );
      if (!claimed) {
        const refreshCooldownUntil = cooldownIso(
          await dependencies.cache.getManualRefreshCooldown(workspaceId, digest),
        );
        if (cached) return { digest, result: cached, refreshCooldownUntil };
        throw new ApiError(
          'AWS_COST_QUERY_BUSY',
          503,
          'The AWS cost query is already running. Try again shortly.',
          true,
        );
      }
    }

    const claim = await dependencies.cache.claimQueryExecution(
      workspaceId,
      digest,
      requestId,
      requestedAt,
    );
    if (claim === 'wait') {
      const waited = await dependencies.cache.waitForCachedCostResult(workspaceId, digest);
      if (waited) return { digest, result: waited };
      throw new ApiError(
        'AWS_COST_QUERY_BUSY',
        503,
        'The AWS cost query is already running. Try again shortly.',
        true,
      );
    }

    try {
      const result = await dependencies.createAwsAdapter().query(request);
      await dependencies.cache.putCachedCostResult(
        workspaceId,
        digest,
        result,
        selectCostResultExpiry(request, requestedAt),
      );
      return { digest, result };
    } finally {
      await dependencies.cache.releaseQueryExecution(workspaceId, digest, requestId);
    }
  }

  return async (event: unknown): Promise<ApiResponse> => {
    const requestId = requestIdFrom(event);
    try {
      const route = resolveRoute(event);
      const { authorization } = await authorizeRequest(event, route.scope, {
        getAuthorizedUser: dependencies.getAuthorizedUser,
      });
      if (authorization.authProvider !== 'COGNITO') {
        throw new ApiError(
          'COGNITO_REAUTH_REQUIRED',
          403,
          'Sign in with Cognito to access AWS Cost Explorer.',
        );
      }

      if (route.operation === 'LIST_REPORTS') {
        return jsonResponse(200, {
          items: await dependencies.reports.listSavedReports(authorization.workspaceId),
        });
      }
      if (route.operation === 'PUT_REPORT') {
        const input = parseCostBody(ReportBodySchema, event);
        const request = validateReport(
          input.request,
          dependencies.granularDataEnabled,
          now(),
        );
        const report = await dependencies.reports.putSavedReport(
          authorization.workspaceId,
          { ...input, request },
        );
        return jsonResponse(201, { report });
      }
      if (route.operation === 'DELETE_REPORT') {
        const reportId = ReportIdSchema.safeParse(route.reportId);
        if (!reportId.success) {
          throw new ApiError('INVALID_REQUEST', 400, 'The report identifier is invalid.');
        }
        const deleted = await dependencies.reports.deleteSavedReport(
          authorization.workspaceId,
          reportId.data,
        );
        if (!deleted) throw new ApiError('NOT_FOUND', 404, 'Saved report not found.');
        return jsonResponse(200, { reportId: reportId.data, deleted: true });
      }
      if (route.operation === 'DIMENSIONS') {
        const input = parseCostBody(DimensionsBodySchema, event);
        const adapter = dependencies.createAwsAdapter();
        if ('type' in input && input.type === 'BILLING_VIEW') {
          return jsonResponse(200, { billingViews: await adapter.listBillingViews() });
        }
        return jsonResponse(
          200,
          paginateDimensionValues(await adapter.listValues(input), input.cursor),
        );
      }

      const input = parseCostBody(QueryBodySchema, event);
      const request = validateReport(
        input.request,
        dependencies.granularDataEnabled,
        now(),
      );

      if (route.operation === 'QUERY') {
        assertMode(request, 'QUERY');
        const execution = await executeQuery(
          authorization.workspaceId,
          requestId,
          request,
          input.refresh,
        );
        return jsonResponse(200, execution);
      }
      if (route.operation === 'FORECAST') {
        assertMode(request, 'QUERY');
        return jsonResponse(200, {
          forecast: await dependencies.createAwsAdapter().forecast(request),
        });
      }
      if (route.operation === 'COMPARISONS') {
        assertMode(request, 'COMPARISONS');
        return jsonResponse(200, {
          comparison: await dependencies.createAwsAdapter().compare(request),
        });
      }

      assertMode(request, 'QUERY');
      const execution = await executeQuery(
        authorization.workspaceId,
        requestId,
        request,
        false,
      );
      return jsonResponse(
        200,
        await dependencies.exporter.exportCsv(
          authorization.workspaceId,
          execution.digest,
          execution.result,
          request,
        ),
      );
    } catch (error) {
      return errorResponse(normalizeHandlerError(error), requestId);
    }
  };
}

export async function handler(event: unknown): Promise<ApiResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const exportBucket = requiredEnvironmentValue('EXPORT_BUCKET');
  const cache = createCostExplorerCache({ client: dynamoDocumentClient, tableName });
  const reports = createSavedCostReportStore({ client: dynamoDocumentClient, tableName });
  const exporter = createCostCsvExporter({ s3: s3Client, bucket: exportBucket });

  return createCostExplorerApiHandler({
    getAuthorizedUser: (sub) => getAuthorizedUser(dynamoDocumentClient, tableName, sub),
    createAwsAdapter: () => new CostExplorerAwsAdapter(createCostExplorerClients()),
    cache,
    reports,
    exporter,
    granularDataEnabled: process.env.GRANULAR_DATA_ENABLED === 'true',
  })(event);
}
