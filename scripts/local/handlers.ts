import { parseStatementPdf } from '@cashight/domain/parsers';
import type { Statement } from '@cashight/domain/schemas';

import { ApiError, type ApiResponse } from '../../backend/shared/api-response';
import {
  deleteWorkspaceStatementMetadata,
  getAuthorizedUser,
  getStatementMetadataById,
  getWorkspaceStatementMetadataById,
  getUploadJobRecord,
  putIdempotencyRecord,
  putStatementMetadata,
  putUploadJobRecord,
  queryUserStatements,
  queryUserStatementsForYear,
  queryWorkspaceStatements,
  queryWorkspaceStatementsForYear,
  transitionJobState,
  upsertAuthorizedUser,
} from '../../backend/shared/metadata';
import { parseStatementObject, statementId } from '../../backend/shared/storage';
import { createDashboardApiHandler } from '../../backend/functions/dashboard-api/handler';
import { createProcessJob, computeSha256 } from '../../backend/functions/parser-worker/process-job';
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

/** The subject the local stack acts as. Seeded as an authorized user on boot. */
export const DEV_SUB = process.env.DEV_AUTH_SUB ?? 'local-dev-user';

const dynamo = createLocalDynamoClient();

const authorizedUser = (sub: string) => getAuthorizedUser(dynamo, TABLE_NAME, sub);

/** Insert the AUTHZ record without which every authorized route returns 403. */
export async function seedAuthorizedUser(sub: string = DEV_SUB): Promise<void> {
  const now = new Date().toISOString();
  await upsertAuthorizedUser(dynamo, TABLE_NAME, {
    PK: `AUTHZ#${sub}`,
    SK: 'PROFILE',
    active: true,
    workspaceId: 'primary',
    authProvider: 'COGNITO',
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

  return {
    uploads,
    uploadStatus,
    statements,
    dashboard,
    summaries,
    sessionCapabilities,
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
