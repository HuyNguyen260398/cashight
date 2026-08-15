import { parseStatementPdf } from '@cashight/domain/parsers';
import { parseAwsInvoicePdf } from '@cashight/domain/parsers/aws-invoice';
import type { Statement } from '@cashight/domain/schemas';
import type { AwsInvoice } from '@cashight/domain/aws-invoices';
import type { AuthProvider } from '@cashight/domain/workspace';
import type {
  CostExplorerReportRequest,
  SavedCostReport,
} from '@cashight/domain/aws-cost-explorer';

import { ApiError, type ApiResponse } from '../../backend/shared/api-response';
import {
  createCostExplorerApiHandler,
  type CostExplorerApiDependencies,
} from '../../backend/functions/cost-explorer-api/handler';
import {
  CostExplorerAwsAdapter,
  type CompleteCostExplorerResult,
  type CostDimensionValue,
} from '../../backend/functions/cost-explorer-api/aws-adapter';
import { createCostExplorerClients } from '../../backend/shared/cost-explorer-clients';
import type { EnvLike } from './cognito-auth';
import { createCostCsv } from '../../backend/functions/cost-explorer-api/csv';
import { SavedReportError } from '../../backend/functions/cost-explorer-api/reports';
import {
  claimAwsInvoiceUploadJob,
  deleteAwsInvoiceMetadata,
  deleteWorkspaceStatementMetadata,
  getAwsInvoiceMetadata,
  getAwsInvoiceUploadJobRecord,
  getAuthorizedUser,
  getStatementMetadataById,
  getWorkspaceStatementMetadataById,
  getUploadJobRecord,
  putIdempotencyRecord,
  putAwsInvoiceMetadata,
  putAwsInvoiceUploadJobRecord,
  putStatementMetadata,
  putUploadJobRecord,
  queryAwsInvoiceMetadata,
  queryUserStatements,
  queryUserStatementsForYear,
  queryWorkspaceStatements,
  queryWorkspaceStatementsForYear,
  transitionJobState,
  transitionAwsInvoiceJobState,
  upsertAuthorizedUser,
} from '../../backend/shared/metadata';
import {
  parseAwsInvoiceObject,
  parseStatementObject,
  statementId,
} from '../../backend/shared/storage';
import { createAwsInvoicesApiHandler } from '../../backend/functions/aws-invoices-api/handler';
import {
  collectAwsInvoiceSummaryResponse,
  prepareAwsInvoiceSummary,
  type AwsInvoiceSummaryDependencies,
} from '../../backend/functions/aws-invoice-summary-api/handler';
import { createDashboardApiHandler } from '../../backend/functions/dashboard-api/handler';
import { createProcessJob, computeSha256 } from '../../backend/functions/parser-worker/process-job';
import {
  computeSha256 as computeAwsInvoiceSha256,
  createInvoiceProcessJob,
} from '../../backend/functions/invoice-parser-worker/process-job';
import { createStatementsApiHandler } from '../../backend/functions/statements-api/handler';
import {
  prepareSummary,
  collectResponse,
  type SummaryHandlerDeps,
} from '../../backend/functions/summary-api/handler';
import { createUploadsApiHandler } from '../../backend/functions/uploads-api/handler';
import { createUploadStatusApiHandler } from '../../backend/functions/upload-status-api/handler';
import { createSessionCapabilitiesApiHandler } from '../../backend/functions/session-capabilities-api/handler';

import { createLocalDynamoClient } from './dynamo';
import {
  STATEMENTS_BUCKET,
  UPLOAD_BUCKET,
  deleteObject,
  getObject,
  objectExists,
  putObject,
} from './object-store';

/**
 * Wires the production Lambda handler factories to local, file-backed
 * dependencies. Every request the dev server serves runs the same handler code
 * that runs in Lambda — only the storage and secret dependencies are swapped.
 */

/** The fixed table name; there is only one local "table". */
const TABLE_NAME = 'cashight-local';
const COST_EXPORT_BUCKET = 'cost-exports';

/** The subject the local stack acts as. Seeded as an authorized user on boot. */
export const DEV_SUB = process.env.DEV_AUTH_SUB ?? 'local-dev-user';

const dynamo = createLocalDynamoClient();

const authorizedUser = (sub: string) => getAuthorizedUser(dynamo, TABLE_NAME, sub);

/**
 * Insert the AUTHZ record without which every authorized route returns 403.
 *
 * `authProvider` is a real authorization input, not a formality: only COGNITO
 * may reach AWS Cost Explorer. It defaults to COGNITO for the boot seed of
 * DEV_SUB — the bypass exists to test everything *except* identity — but a
 * caller seeding a signed-in user must pass what that user actually used.
 */
export async function seedAuthorizedUser(
  sub: string = DEV_SUB,
  authProvider: AuthProvider = 'COGNITO',
): Promise<void> {
  const now = new Date().toISOString();
  await upsertAuthorizedUser(dynamo, TABLE_NAME, {
    PK: `AUTHZ#${sub}`,
    SK: 'PROFILE',
    active: true,
    workspaceId: 'primary',
    authProvider,
    createdAt: now,
    updatedAt: now,
  });
}

// ── S3 object helpers shared by the API handlers ──────────────────────────────

async function getStatementObject(objectKey: string): Promise<Statement> {
  try {
    return parseStatementObject(await getObject(STATEMENTS_BUCKET, objectKey));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('NOT_FOUND', 404, 'Statement object not found.');
  }
}

async function getAwsInvoiceObject(objectKey: string): Promise<AwsInvoice> {
  try {
    return parseAwsInvoiceObject(await getObject(STATEMENTS_BUCKET, objectKey));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('NOT_FOUND', 404, 'AWS invoice object not found.');
  }
}

const syntheticAwsInvoice: AwsInvoice = {
  seller: 'Amazon Web Services, Inc.',
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD',
  totals: { charges: 42, credits: 2, tax: 4.2, amountDue: 44.2 },
  services: [
    { name: 'Example Compute', charges: 30, tax: 3, total: 33 },
    { name: 'Example Storage', charges: 12, tax: 1.2, total: 13.2 },
  ],
  linkedAccounts: [
    {
      accountLast4: '0001',
      charges: 42,
      credits: 2,
      tax: 4.2,
      total: 44.2,
      services: [
        { name: 'Example Compute', charges: 30, tax: 3, total: 33 },
        { name: 'Example Storage', charges: 12, tax: 1.2, total: 13.2 },
      ],
    },
  ],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: '0'.repeat(64),
    uploadedAt: '2026-08-03T00:00:00.000Z',
  },
};

export async function seedSyntheticAwsInvoice(): Promise<void> {
  const existing = await getAwsInvoiceMetadata(
    dynamo,
    TABLE_NAME,
    'primary',
    '2026-07',
  );
  if (existing) return;
  const objectKey = 'users/primary/aws-invoices/2026/2026-07.json';
  await putObject(
    STATEMENTS_BUCKET,
    objectKey,
    `${JSON.stringify(syntheticAwsInvoice, null, 2)}\n`,
  );
  await putAwsInvoiceMetadata(dynamo, TABLE_NAME, {
    PK: 'WORKSPACE#primary',
    SK: 'AWS_INVOICE#2026-07',
    yearMonth: '2026-07',
    objectKey,
    currency: 'USD',
    amountDue: syntheticAwsInvoice.totals.amountDue,
    tax: syntheticAwsInvoice.totals.tax,
    serviceCount: syntheticAwsInvoice.services.length,
    linkedAccountCount: syntheticAwsInvoice.linkedAccounts.length,
    sha256: syntheticAwsInvoice.source.sha256,
    parserId: syntheticAwsInvoice.source.parserId,
    parserVersion: syntheticAwsInvoice.source.parserVersion,
    uploadedAt: syntheticAwsInvoice.source.uploadedAt,
  });
}

// ── API handlers ──────────────────────────────────────────────────────────────

export interface LocalPresignOptions {
  /** Base URL the browser should PUT the PDF to, e.g. http://localhost:8787 */
  apiBaseUrl: string;
}

/**
 * Stands in for the S3 presigned PUT. There is no signature to verify locally,
 * so the "presigned" URL is just the dev server's own upload endpoint — the
 * key is carried in the path exactly as it would be in S3.
 */
function createLocalPresign({ apiBaseUrl }: LocalPresignOptions) {
  return async (params: { key: string; contentType: string }) => ({
    url: `${apiBaseUrl}/_local/objects/${UPLOAD_BUCKET}/${params.key}`,
    headers: { 'Content-Type': params.contentType },
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });
}

function monthlyPeriods(request: CostExplorerReportRequest) {
  if (request.granularity !== 'MONTHLY') {
    return [{
      start: request.timePeriod.start,
      end: request.timePeriod.end,
      estimated: false,
    }];
  }
  const periods: Array<{ start: string; end: string; estimated: boolean }> = [];
  let cursor = request.timePeriod.start;
  while (cursor < request.timePeriod.end) {
    const date = new Date(`${cursor}T00:00:00.000Z`);
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
    periods.push({
      start: cursor,
      end: next < request.timePeriod.end ? next : request.timePeriod.end,
      estimated: false,
    });
    cursor = next;
  }
  return periods;
}

function fixedCostResult(
  request: CostExplorerReportRequest,
  asOf: Date,
): CompleteCostExplorerResult {
  const periods = monthlyPeriods(request);
  const computeValues = periods.map((_, index) => `${10 + index}.25`);
  const storageValues = periods.map((_, index) => `${2 + index}.50`);
  const computeTotal = computeValues.reduce((sum, value) => sum + Number(value), 0);
  const storageTotal = storageValues.reduce((sum, value) => sum + Number(value), 0);
  const total = computeTotal + storageTotal;
  const totalValues = periods.map((_, index) =>
    (Number(computeValues[index]) + Number(storageValues[index])).toFixed(2),
  );
  const grouped = request.groupBy.length > 0;
  return {
    source: 'AWS',
    asOf: asOf.toISOString(),
    currencyOrUnit: 'USD',
    estimated: false,
    overview: {
      total: total.toFixed(2),
      average: (total / periods.length).toFixed(2),
    },
    periods,
    series: grouped
      ? [
          {
            key: 'Example Compute',
            label: 'Example Compute',
            values: computeValues,
            total: computeTotal.toFixed(2),
          },
          {
            key: 'Example Storage',
            label: 'Example Storage',
            values: storageValues,
            total: storageTotal.toFixed(2),
          },
        ]
      : [{ key: 'Total', label: 'Total', values: totalValues, total: total.toFixed(2) }],
    breakdown: grouped
      ? [
          {
            groupValues: ['Example Compute'],
            values: computeValues,
            total: computeTotal.toFixed(2),
            estimated: false,
          },
          {
            groupValues: ['Example Storage'],
            values: storageValues,
            total: storageTotal.toFixed(2),
            estimated: false,
          },
        ]
      : [{ groupValues: [], values: totalValues, total: total.toFixed(2), estimated: false }],
    comparisonDrivers: [],
    pageCount: 2,
  };
}

function compareSavedReports(left: SavedCostReport, right: SavedCostReport): number {
  const leftName = left.name.normalize('NFKC').toLowerCase();
  const rightName = right.name.normalize('NFKC').toLowerCase();
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;
  return left.reportId < right.reportId ? -1 : left.reportId > right.reportId ? 1 : 0;
}

export type LocalCostExplorerMode = 'fake' | 'real';

/**
 * Which Cost Explorer data source the local stack uses.
 *
 * Synthetic by default: the whole point of `pnpm dev:local` is running with no
 * AWS account, and the real API bills roughly $0.01 per (paginated) request.
 * `LOCAL_AWS_COST_EXPLORER=real` opts in to your own account's figures, read
 * through the ambient AWS credentials (`~/.aws`, `AWS_PROFILE`, SSO session).
 */
export function resolveCostExplorerMode(
  env: EnvLike = process.env,
): LocalCostExplorerMode {
  return (env.LOCAL_AWS_COST_EXPLORER ?? '').trim().toLowerCase() === 'real'
    ? 'real'
    : 'fake';
}

/**
 * Fixed figures that exercise every shape the dashboard renders — series,
 * breakdown, forecast, comparison, dimension paging — without touching AWS.
 */
function createFakeCostExplorerAdapter() {
  return {
    query: async (request: CostExplorerReportRequest) => fixedCostResult(request, new Date()),
    forecast: async () => ({
      total: '21.75',
      unit: 'USD',
      periods: [
        {
          start: '2026-03-01',
          end: '2026-04-01',
          mean: '21.75',
          lowerBound: '18.00',
          upperBound: '25.50',
        },
      ],
    }),
    compare: async () => ({
      comparisons: [],
      total: {
        UnblendedCost: {
          baseline: '16.50',
          comparison: '18.01',
          difference: '1.51',
          unit: 'USD',
        },
      },
      drivers: [
        {
          groupValues: ['Example Compute'],
          type: 'SERVICE',
          name: 'Example Compute',
          metrics: {},
        },
      ],
      pageCount: 2,
    }),
    listValues: async (): Promise<CostDimensionValue[]> =>
      Array.from({ length: 60 }, (_, index) => ({
        value: `Example Service ${String(index + 1).padStart(2, '0')}`,
      })),
    listBillingViews: async () => [
      { arn: 'arn:aws:billing::000000000000:billingview/local-primary', name: 'Local primary' },
      { arn: 'arn:aws:billing::000000000000:billingview/local-team', name: 'Local team' },
    ],
  };
}

/**
 * The same adapter the Lambda constructs, pointed at your own account.
 *
 * Only the data source changes: the result cache, saved reports and CSV export
 * below stay local, so nothing is written to AWS and no DynamoDB/S3 access is
 * needed — just `ce:` and `billing:` reads.
 */
export function createLocalCostExplorerAdapter(
  mode: LocalCostExplorerMode = resolveCostExplorerMode(),
) {
  return mode === 'real'
    ? new CostExplorerAwsAdapter(createCostExplorerClients())
    : createFakeCostExplorerAdapter();
}

export function createLocalCostExplorerDependencies(
  { apiBaseUrl }: LocalPresignOptions,
): CostExplorerApiDependencies {
  const cache = new Map<string, CompleteCostExplorerResult>();
  const refreshClaims = new Map<string, number>();
  const queryLocks = new Set<string>();
  const savedReports = new Map<string, SavedCostReport>();
  let reportSequence = 0;

  const adapter = createLocalCostExplorerAdapter();

  return {
    getAuthorizedUser: authorizedUser,
    createAwsAdapter: () => adapter,
    cache: {
      getCachedCostResult: async (_workspaceId, digest) => {
        const result = cache.get(digest);
        return result ? { ...result, source: 'CACHE' as const } : undefined;
      },
      putCachedCostResult: async (_workspaceId, digest, result) => {
        cache.set(digest, result);
      },
      claimManualRefresh: async (_workspaceId, digest, claimedAt) => {
        const epoch = Math.floor(claimedAt.getTime() / 1_000);
        const expiresAt = refreshClaims.get(digest) ?? 0;
        if (expiresAt > epoch) return false;
        refreshClaims.set(digest, epoch + 300);
        return true;
      },
      getManualRefreshCooldown: async (_workspaceId, digest) => refreshClaims.get(digest),
      claimQueryExecution: async (_workspaceId, digest) => {
        if (queryLocks.has(digest)) return 'wait' as const;
        queryLocks.add(digest);
        return 'owner' as const;
      },
      releaseQueryExecution: async (_workspaceId, digest) => {
        queryLocks.delete(digest);
      },
      waitForCachedCostResult: async (_workspaceId, digest) => {
        const result = cache.get(digest);
        return result ? { ...result, source: 'CACHE' as const } : undefined;
      },
    },
    reports: {
      listSavedReports: async () => [...savedReports.values()].sort(compareSavedReports),
      putSavedReport: async (_workspaceId, input) => {
        const duplicate = [...savedReports.values()].some(
          (report) =>
            report.reportId !== input.reportId &&
            report.name.normalize('NFKC').toLowerCase() ===
              input.name.normalize('NFKC').toLowerCase(),
        );
        if (duplicate) throw new SavedReportError('DUPLICATE_REPORT_NAME');
        const existing = input.reportId ? savedReports.get(input.reportId) : undefined;
        reportSequence += 1;
        const reportId = input.reportId ??
          `00000000-0000-4000-8000-${String(reportSequence).padStart(12, '0')}`;
        const timestamp = new Date().toISOString();
        const report = {
          reportId,
          name: input.name,
          request: input.request,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        savedReports.set(reportId, report);
        return report;
      },
      deleteSavedReport: async (_workspaceId, reportId) => savedReports.delete(reportId),
    },
    exporter: {
      exportCsv: async (workspaceId, digest, result, request) => {
        const createdAt = new Date();
        const exportId = crypto.randomUUID();
        const fileName = `cashight-cost-explorer-${createdAt.toISOString().slice(0, 10)}.csv`;
        const key = `exports/${workspaceId}/${digest}/${exportId}.csv`;
        await putObject(COST_EXPORT_BUCKET, key, Buffer.from(createCostCsv(result, request)));
        return {
          downloadUrl: `${apiBaseUrl}/_local/objects/${COST_EXPORT_BUCKET}/${key}`,
          expiresAt: new Date(createdAt.getTime() + 300_000).toISOString(),
          fileName,
        };
      },
    },
    granularDataEnabled: false,
  };
}

export function createLocalHandlers(options: LocalPresignOptions) {
  const uploads = createUploadsApiHandler({
    getAuthorizedUser: authorizedUser,
    putJobRecord: (record) => putUploadJobRecord(dynamo, TABLE_NAME, record),
    presign: createLocalPresign(options),
    now: () => new Date(),
  });

  const uploadStatus = createUploadStatusApiHandler({
    getAuthorizedUser: authorizedUser,
    getJobRecord: (jobId) => getUploadJobRecord(dynamo, TABLE_NAME, jobId),
  });

  const statements = createStatementsApiHandler({
    getAuthorizedUser: authorizedUser,
    queryStatements: (workspaceId, cursor, limit) =>
      queryWorkspaceStatements(dynamo, TABLE_NAME, workspaceId, cursor, limit),
    queryLegacyStatements: (sub, cursor, limit) =>
      queryUserStatements(dynamo, TABLE_NAME, sub, cursor, limit),
    getStatementMetadata: (workspaceId, id) =>
      getWorkspaceStatementMetadataById(dynamo, TABLE_NAME, workspaceId, id),
    getLegacyStatementMetadata: (sub, id) =>
      getStatementMetadataById(dynamo, TABLE_NAME, sub, id),
    getStatementObject,
    deleteStatementObject: (objectKey) => deleteObject(STATEMENTS_BUCKET, objectKey),
    deleteStatementMetadata: (workspaceId, id) =>
      deleteWorkspaceStatementMetadata(dynamo, TABLE_NAME, workspaceId, id),
    enableLegacyWorkspaceFallback:
      process.env.ENABLE_LEGACY_WORKSPACE_FALLBACK === 'true',
  });

  const dashboard = createDashboardApiHandler({
    getAuthorizedUser: authorizedUser,
    queryStatementsForYear: (workspaceId, year) =>
      queryWorkspaceStatementsForYear(dynamo, TABLE_NAME, workspaceId, year),
    queryLegacyStatementsForYear: (sub, year) =>
      queryUserStatementsForYear(dynamo, TABLE_NAME, sub, year),
    getStatementObject,
    enableLegacyWorkspaceFallback:
      process.env.ENABLE_LEGACY_WORKSPACE_FALLBACK === 'true',
  });

  const summaries = async (event: unknown): Promise<ApiResponse> =>
    collectResponse(await prepareSummary(event, createLocalSummaryDeps()));

  const sessionCapabilities = createSessionCapabilitiesApiHandler({
    getAuthorizedUser: authorizedUser,
  });

  const costExplorer = createCostExplorerApiHandler(
    createLocalCostExplorerDependencies(options),
  );

  const awsInvoices = createAwsInvoicesApiHandler({
    getAuthorizedUser: authorizedUser,
    putJobRecord: (record) =>
      putAwsInvoiceUploadJobRecord(dynamo, TABLE_NAME, record),
    getJobRecord: (jobId) =>
      getAwsInvoiceUploadJobRecord(dynamo, TABLE_NAME, jobId),
    presign: createLocalPresign(options),
    queryMetadata: (workspaceId, cursor, limit) =>
      queryAwsInvoiceMetadata(
        dynamo,
        TABLE_NAME,
        workspaceId,
        cursor,
        limit,
      ),
    getMetadata: (workspaceId, yearMonth) =>
      getAwsInvoiceMetadata(dynamo, TABLE_NAME, workspaceId, yearMonth),
    getInvoiceObject: getAwsInvoiceObject,
    deleteInvoiceObject: (objectKey) =>
      deleteObject(STATEMENTS_BUCKET, objectKey),
    deleteMetadata: (workspaceId, yearMonth) =>
      deleteAwsInvoiceMetadata(dynamo, TABLE_NAME, workspaceId, yearMonth),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
  });

  const awsInvoiceSummaries = async (event: unknown): Promise<ApiResponse> =>
    collectAwsInvoiceSummaryResponse(
      await prepareAwsInvoiceSummary(
        event,
        createLocalAwsInvoiceSummaryDependencies(),
      ),
    );

  return {
    uploads,
    uploadStatus,
    statements,
    dashboard,
    summaries,
    sessionCapabilities,
    costExplorer,
    awsInvoices,
    awsInvoiceSummaries,
  };
}

function createLocalAwsInvoiceSummaryDependencies(): AwsInvoiceSummaryDependencies {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return {
    getAuthorizedUser: authorizedUser,
    getMetadata: (workspaceId, yearMonth) =>
      getAwsInvoiceMetadata(dynamo, TABLE_NAME, workspaceId, yearMonth),
    queryMetadata: (workspaceId, cursor, limit) =>
      queryAwsInvoiceMetadata(
        dynamo,
        TABLE_NAME,
        workspaceId,
        cursor,
        limit,
      ),
    getInvoiceObject: getAwsInvoiceObject,
    getApiKey: async () => apiKey || 'local-stub-key',
    generateStream: (prompt, key) => {
      if (!apiKey) return stubSummaryStream();
      return (async function* real() {
        const { streamSummary } = await import('../../backend/shared/gemini');
        yield* streamSummary(prompt, key);
      })();
    },
  };
}

// ── Gemini: real when a key is configured, canned otherwise ───────────────────

async function* stubSummaryStream(): AsyncGenerator<string> {
  yield 'Local stub summary — GEMINI_API_KEY is not set, so no model was called. ';
  yield 'Set GEMINI_API_KEY in .env.local to exercise the real Gemini path. ';
  yield 'The aggregate payload was still built and anonymized by buildSummaryPayload().';
}

function createLocalSummaryDeps(): SummaryHandlerDeps {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return {
    getAuthorizedUser: authorizedUser,
    // Never undefined, so the handler proceeds to the stream path even without
    // a real key — otherwise the local summary route would always 503.
    getApiKey: async () => apiKey || 'local-stub-key',
    generateStream: (prompt, key) => {
      if (!apiKey) return stubSummaryStream();
      return (async function* real() {
        const { streamSummary } = await import('../../backend/shared/gemini');
        yield* streamSummary(prompt, key);
      })();
    },
  };
}

// ── Parser worker ─────────────────────────────────────────────────────────────

/**
 * The local equivalent of the SQS-triggered parser Lambda. The dev server
 * calls this directly after a PDF lands in the fake upload bucket, which is
 * the same trigger S3 → SQS → Lambda provides in production.
 */
export const processUploadedPdf = createProcessJob({
  getJobRecord: (jobId) => getUploadJobRecord(dynamo, TABLE_NAME, jobId),

  transitionToProcessing: (jobId) =>
    transitionJobState(
      dynamo,
      TABLE_NAME,
      jobId,
      'PENDING_UPLOAD',
      'PROCESSING',
      new Date().toISOString(),
      {},
    ),

  putIdempotencyRecord: (jobId, sha256) =>
    putIdempotencyRecord(
      dynamo,
      TABLE_NAME,
      jobId,
      sha256,
      Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    ),

  transitionToTerminal: (jobId, state, extra = {}) =>
    transitionJobState(
      dynamo,
      TABLE_NAME,
      jobId,
      'PROCESSING',
      state,
      new Date().toISOString(),
      extra,
    ).then(() => undefined),

  downloadPdf: (key) => getObject(UPLOAD_BUCKET, key),
  deletePdf: (key) => deleteObject(UPLOAD_BUCKET, key),

  // In production this reads Secrets Manager; locally the password comes
  // straight from .env.local. PDF_PASSWORDS holds the same JSON map as the
  // production secret; PDF_PASSWORD remains valid as a single password.
  // Empty string means "no password".
  getSecret: async () =>
    process.env.PDF_PASSWORDS ?? process.env.PDF_PASSWORD ?? '',

  parsePdf: (buffer, passwords) => parseStatementPdf(buffer, passwords),

  checkDestinationExists: (key) => objectExists(STATEMENTS_BUCKET, key),

  writeStatement: (key, statement) =>
    putObject(STATEMENTS_BUCKET, key, `${JSON.stringify(statement, null, 2)}\n`),

  writeMetadata: async ({ owner, statement, objectKey, sha256, uploadedAt }) => {
    const [year, month] = statement.statementDate.split('-').map(Number);
    const mm = String(month).padStart(2, '0');
    await putStatementMetadata(dynamo, TABLE_NAME, {
      PK: `WORKSPACE#${owner.workspaceId}`,
      SK: `STATEMENT#${year}-${mm}#${statement.cardLast4}`,
      statementId: statementId(statement.cardLast4, year, month),
      objectKey,
      cardLast4: statement.cardLast4,
      bank: statement.bank,
      statementDate: statement.statementDate,
      totalSpend: statement.totals.totalSpend,
      transactionCount: statement.transactions.length,
      sha256,
      uploadedAt,
    });
  },

  computeSha256,
  now: () => new Date(),
  enableLegacyWorkspaceFallback:
    process.env.ENABLE_LEGACY_WORKSPACE_FALLBACK === 'true',
});

export const processUploadedAwsInvoicePdf = createInvoiceProcessJob({
  getJobRecord: (jobId) =>
    getAwsInvoiceUploadJobRecord(dynamo, TABLE_NAME, jobId),
  claimJob: (jobId, claimId) =>
    claimAwsInvoiceUploadJob(
      dynamo,
      TABLE_NAME,
      jobId,
      claimId,
      new Date().toISOString(),
    ),
  transitionToTerminal: (jobId, state, extra) =>
    transitionAwsInvoiceJobState(
      dynamo,
      TABLE_NAME,
      jobId,
      'PROCESSING',
      state,
      new Date().toISOString(),
      extra,
    ).then(() => undefined),
  downloadPdf: (key) => getObject(UPLOAD_BUCKET, key),
  deletePdf: (key) => deleteObject(UPLOAD_BUCKET, key),
  computeSha256: computeAwsInvoiceSha256,
  parsePdf: parseAwsInvoicePdf,
  getMetadata: (workspaceId, yearMonth) =>
    getAwsInvoiceMetadata(dynamo, TABLE_NAME, workspaceId, yearMonth),
  getDestinationInvoice: async (key) =>
    (await objectExists(STATEMENTS_BUCKET, key))
      ? getAwsInvoiceObject(key)
      : undefined,
  writeInvoice: (key, parsedInvoice) =>
    putObject(
      STATEMENTS_BUCKET,
      key,
      `${JSON.stringify(parsedInvoice, null, 2)}\n`,
    ),
  writeMetadata: (record) =>
    putAwsInvoiceMetadata(dynamo, TABLE_NAME, record),
});
