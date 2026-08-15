import { GetObjectCommand } from '@aws-sdk/client-s3';
import { buildAwsInvoiceSummaryPayload } from '@cashight/domain/aws-invoice-summary-payload';
import {
  AwsInvoiceSchema,
  YearMonthSchema,
  type AwsInvoice,
} from '@cashight/domain/aws-invoices';
import { z } from 'zod';

import {
  ApiError,
  errorResponse,
  textResponse,
  type ApiResponse,
} from '../../shared/api-response';
import { authorizeRequest } from '../../shared/auth-claims';
import { dynamoDocumentClient, s3Client } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  assertAwsInvoiceRecordOwner,
  getAuthorizedUser,
  getAwsInvoiceMetadata,
  queryAwsInvoiceMetadata,
  type AwsInvoiceMetadataRecord,
  type AwsInvoiceQueryResult,
} from '../../shared/metadata';
import { getSecretString } from '../../shared/secrets';
import { parseAwsInvoiceObject } from '../../shared/storage';
import { buildAwsInvoicePrompt } from './prompt';

const requestSchema = z.object({ yearMonth: YearMonthSchema }).strict();
const MAX_HISTORY_PAGES = 100;

export interface AwsInvoiceSummaryDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  getMetadata: (
    workspaceId: 'primary',
    yearMonth: string,
  ) => Promise<AwsInvoiceMetadataRecord | undefined>;
  queryMetadata: (
    workspaceId: 'primary',
    cursor: Record<string, unknown> | null,
    limit?: number,
  ) => Promise<AwsInvoiceQueryResult>;
  getInvoiceObject: (objectKey: string) => Promise<AwsInvoice>;
  getApiKey: () => Promise<string | undefined>;
  generateStream: (prompt: string, apiKey: string) => AsyncGenerator<string>;
}

export type AwsInvoiceSummaryResult =
  | { type: 'error'; response: ApiResponse }
  | {
      type: 'stream';
      firstChunk: string;
      generator: AsyncGenerator<string>;
    };

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(message);
}

async function loadHistory(
  deps: AwsInvoiceSummaryDependencies,
  workspaceId: 'primary',
): Promise<AwsInvoiceMetadataRecord[]> {
  const history: AwsInvoiceMetadataRecord[] = [];
  let cursor: Record<string, unknown> | null = null;
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await deps.queryMetadata(workspaceId, cursor, 100);
    for (const item of result.items) {
      assertAwsInvoiceRecordOwner(workspaceId, item);
      history.push(item);
    }
    if (!result.nextCursor) return history;
    cursor = result.nextCursor;
  }
  throw new ApiError(
    'DATA_INTEGRITY_ERROR',
    500,
    'Invoice history pagination exceeded its safe bound.',
  );
}

export async function prepareAwsInvoiceSummary(
  event: unknown,
  deps: AwsInvoiceSummaryDependencies,
): Promise<AwsInvoiceSummaryResult> {
  const requestId =
    (event as { requestContext?: { requestId?: string } }).requestContext
      ?.requestId ?? 'unknown';
  try {
    const { authorization } = await authorizeRequest(event, 'cashight/read', {
      getAuthorizedUser: deps.getAuthorizedUser,
    });
    let request: z.infer<typeof requestSchema>;
    try {
      const body = (event as { body?: string | null }).body ?? '{}';
      request = requestSchema.parse(JSON.parse(body));
    } catch {
      throw new ApiError('INVALID_REQUEST', 400, 'Invalid request body.');
    }

    const metadata = await deps.getMetadata(
      authorization.workspaceId,
      request.yearMonth,
    );
    if (!metadata) {
      throw new ApiError('NOT_FOUND', 404, 'AWS invoice not found.');
    }
    assertAwsInvoiceRecordOwner(authorization.workspaceId, metadata);
    let invoice: AwsInvoice;
    try {
      invoice = AwsInvoiceSchema.parse(
        await deps.getInvoiceObject(metadata.objectKey),
      );
    } catch {
      throw new ApiError(
        'DATA_INTEGRITY_ERROR',
        500,
        'Invalid AWS invoice object.',
      );
    }
    const history = await loadHistory(deps, authorization.workspaceId);
    const payload = buildAwsInvoiceSummaryPayload(invoice, history);
    const prompt = buildAwsInvoicePrompt(payload);
    const apiKey = await deps.getApiKey();
    if (!apiKey) {
      throw new ApiError(
        'SERVICE_UNAVAILABLE',
        503,
        'AI summary is not configured.',
      );
    }
    const generator = deps.generateStream(prompt, apiKey);
    try {
      const first = await generator.next();
      return {
        type: 'stream',
        firstChunk: first.done ? '' : (first.value ?? ''),
        generator,
      };
    } catch (error) {
      if (isRateLimitError(error)) {
        throw new ApiError(
          'RATE_LIMITED',
          429,
          'AI summary rate limit exceeded. Try again shortly.',
        );
      }
      throw new ApiError(
        'UPSTREAM_ERROR',
        500,
        'AI summary generation failed.',
      );
    }
  } catch (error) {
    return { type: 'error', response: errorResponse(error, requestId) };
  }
}

export async function collectAwsInvoiceSummaryResponse(
  result: AwsInvoiceSummaryResult,
): Promise<ApiResponse> {
  if (result.type === 'error') return result.response;
  let body = result.firstChunk;
  for await (const chunk of result.generator) body += chunk;
  return textResponse(200, body);
}

async function defaultGetInvoiceObject(
  bucket: string,
  key: string,
): Promise<AwsInvoice> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = await response.Body?.transformToByteArray();
  if (!body) throw new Error('AWS invoice object is empty.');
  return parseAwsInvoiceObject(body);
}

async function defaultGetApiKey(): Promise<string | undefined> {
  try {
    return (
      (await getSecretString(requiredEnvironmentValue('GEMINI_PARAM'))) ||
      undefined
    );
  } catch {
    return undefined;
  }
}

async function* defaultGenerateStream(
  prompt: string,
  apiKey: string,
): AsyncGenerator<string> {
  const { streamSummary } = await import('../../shared/gemini');
  yield* streamSummary(prompt, apiKey);
}

export async function handler(event: unknown): Promise<ApiResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const statementsBucket = requiredEnvironmentValue('STATEMENTS_BUCKET');
  const result = await prepareAwsInvoiceSummary(event, {
    getAuthorizedUser: (sub) =>
      getAuthorizedUser(dynamoDocumentClient, tableName, sub),
    getMetadata: (workspaceId, yearMonth) =>
      getAwsInvoiceMetadata(
        dynamoDocumentClient,
        tableName,
        workspaceId,
        yearMonth,
      ),
    queryMetadata: (workspaceId, cursor, limit) =>
      queryAwsInvoiceMetadata(
        dynamoDocumentClient,
        tableName,
        workspaceId,
        cursor,
        limit,
      ),
    getInvoiceObject: (key) =>
      defaultGetInvoiceObject(statementsBucket, key),
    getApiKey: defaultGetApiKey,
    generateStream: defaultGenerateStream,
  });
  return collectAwsInvoiceSummaryResponse(result);
}
