import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CreateUploadRequestSchema } from '@cashight/domain/api';
import { aggregateAwsInvoiceDashboard } from '@cashight/domain/aws-invoice-aggregations';
import {
  AwsInvoiceSchema,
  AwsInvoiceUploadJobSchema,
  YearMonthSchema,
  type AwsInvoice,
  type AwsInvoiceUploadJob,
} from '@cashight/domain/aws-invoices';
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
import {
  assertAwsInvoiceRecordOwner,
  deleteAwsInvoiceMetadata,
  getAuthorizedUser,
  getAwsInvoiceMetadata,
  getAwsInvoiceUploadJobRecord,
  putAwsInvoiceUploadJobRecord,
  queryAwsInvoiceMetadata,
  type AwsInvoiceMetadataRecord,
  type AwsInvoiceQueryResult,
  type AwsInvoiceUploadJobRecord,
} from '../../shared/metadata';
import { parseAwsInvoiceObject } from '../../shared/storage';

const UPLOAD_EXPIRY_SECONDS = 300;
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_HISTORY_PAGES = 100;

const cursorSchema = z
  .object({
    PK: z.literal('WORKSPACE#primary'),
    SK: z.string().regex(/^AWS_INVOICE#\d{4}-(0[1-9]|1[0-2])$/),
  })
  .strict();

export interface InvoicePresignResult {
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface AwsInvoicesApiDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  putJobRecord: (record: AwsInvoiceUploadJobRecord) => Promise<void>;
  getJobRecord: (jobId: string) => Promise<AwsInvoiceUploadJobRecord | undefined>;
  presign: (params: {
    key: string;
    sha256Base64: string;
    contentType: string;
    size: number;
    expiresInSeconds: number;
  }) => Promise<InvoicePresignResult>;
  queryMetadata: (
    workspaceId: 'primary',
    cursor: Record<string, unknown> | null,
    limit?: number,
  ) => Promise<AwsInvoiceQueryResult>;
  getMetadata: (
    workspaceId: 'primary',
    yearMonth: string,
  ) => Promise<AwsInvoiceMetadataRecord | undefined>;
  getInvoiceObject: (objectKey: string) => Promise<AwsInvoice>;
  deleteInvoiceObject: (objectKey: string) => Promise<void>;
  deleteMetadata: (workspaceId: 'primary', yearMonth: string) => Promise<void>;
  now: () => Date;
  randomUUID: () => string;
}

function methodOf(event: unknown): string {
  return (event as { httpMethod?: string }).httpMethod?.toUpperCase() ?? 'GET';
}

function pathOf(event: unknown): string {
  return (event as { path?: string }).path ?? '';
}

function pathParam(event: unknown, name: string): string | undefined {
  return (event as { pathParameters?: Record<string, string> | null })
    .pathParameters?.[name];
}

function queryParam(event: unknown, name: string): string | undefined {
  return (event as { queryStringParameters?: Record<string, string> | null })
    .queryStringParameters?.[name];
}

function scopeFor(method: string): RequiredScope {
  return method === 'POST' || method === 'DELETE'
    ? 'cashight/write'
    : 'cashight/read';
}

function parseBody(event: unknown): z.infer<typeof CreateUploadRequestSchema> {
  try {
    const body = (event as { body?: string | null }).body ?? '{}';
    return CreateUploadRequestSchema.parse(JSON.parse(body));
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw new ApiError('INVALID_REQUEST', 400, 'The request is invalid.');
  }
}

function parseCursor(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
  } catch {
    throw new ApiError('INVALID_REQUEST', 400, 'Invalid cursor value.');
  }
}

function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function metadataSummary(record: AwsInvoiceMetadataRecord) {
  return {
    yearMonth: record.yearMonth,
    currency: record.currency,
    amountDue: record.amountDue,
    tax: record.tax,
    serviceCount: record.serviceCount,
    linkedAccountCount: record.linkedAccountCount,
    uploadedAt: record.uploadedAt,
  };
}

function publicJob(record: AwsInvoiceUploadJobRecord): AwsInvoiceUploadJob {
  return AwsInvoiceUploadJobSchema.parse({
    jobId: record.PK.slice('JOB#'.length),
    documentType: record.documentType,
    owner: { workspaceId: record.owner.workspaceId },
    state: record.state,
    force: record.force,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAtEpoch,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    ...(record.yearMonth ? { yearMonth: record.yearMonth } : {}),
    ...(record.conflict ? { conflict: record.conflict } : {}),
  });
}

async function loadAllMetadata(
  deps: AwsInvoicesApiDependencies,
  workspaceId: 'primary',
): Promise<AwsInvoiceMetadataRecord[]> {
  const items: AwsInvoiceMetadataRecord[] = [];
  let cursor: Record<string, unknown> | null = null;
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await deps.queryMetadata(workspaceId, cursor, 100);
    for (const item of result.items) {
      assertAwsInvoiceRecordOwner(workspaceId, item);
      items.push(item);
    }
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }
  throw new ApiError(
    'DATA_INTEGRITY_ERROR',
    500,
    'Invoice history pagination exceeded its safe bound.',
  );
}

export function createAwsInvoicesApiHandler(deps: AwsInvoicesApiDependencies) {
  return async (event: unknown): Promise<ApiResponse> => {
    const requestId =
      (event as { requestContext?: { requestId?: string } }).requestContext
        ?.requestId ?? 'unknown';

    try {
      const method = methodOf(event);
      const path = pathOf(event);
      const { claims, authorization } = await authorizeRequest(
        event,
        scopeFor(method),
        { getAuthorizedUser: deps.getAuthorizedUser },
      );

      if (method === 'POST' && path.endsWith('/uploads')) {
        const input = parseBody(event);
        const jobId = z.string().uuid().parse(deps.randomUUID());
        const now = deps.now();
        const timestamp = now.toISOString();
        const expiresAtEpoch =
          Math.floor(now.getTime() / 1_000) + JOB_TTL_SECONDS;
        const key = `uploads/aws-invoices/${authorization.workspaceId}/${jobId}.pdf`;
        const presigned = await deps.presign({
          key,
          sha256Base64: Buffer.from(input.sha256, 'hex').toString('base64'),
          contentType: input.contentType,
          size: input.size,
          expiresInSeconds: UPLOAD_EXPIRY_SECONDS,
        });
        const record: AwsInvoiceUploadJobRecord = {
          PK: `JOB#${jobId}`,
          SK: 'METADATA',
          documentType: 'AWS_INVOICE',
          owner: {
            workspaceId: authorization.workspaceId,
            subject: claims.sub,
          },
          state: 'PENDING_UPLOAD',
          sha256: input.sha256,
          force: input.force,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAtEpoch,
        };
        await deps.putJobRecord(record);
        return jsonResponse(200, {
          job: publicJob(record),
          upload: {
            url: presigned.url,
            method: 'PUT',
            headers: presigned.headers,
            expiresAt: presigned.expiresAt,
          },
        });
      }

      const jobId = pathParam(event, 'jobId');
      if (method === 'GET' && jobId) {
        const safeJobId = z.string().uuid().parse(jobId);
        const record = await deps.getJobRecord(safeJobId);
        if (!record) {
          throw new ApiError('NOT_FOUND', 404, 'Invoice upload job not found.');
        }
        if (record.owner.workspaceId !== authorization.workspaceId) {
          throw new ApiError('FORBIDDEN', 403, 'Access denied.');
        }
        return jsonResponse(200, { job: publicJob(record) });
      }

      if (method === 'GET' && path.endsWith('/dashboard')) {
        const requestedMonth = queryParam(event, 'yearMonth');
        if (requestedMonth) YearMonthSchema.parse(requestedMonth);
        const history = await loadAllMetadata(deps, authorization.workspaceId);
        const selectedMonth = requestedMonth ?? history[0]?.yearMonth;
        if (!selectedMonth) {
          throw new ApiError('NOT_FOUND', 404, 'No AWS invoices found.');
        }
        const selectedMetadata = await deps.getMetadata(
          authorization.workspaceId,
          selectedMonth,
        );
        if (!selectedMetadata) {
          throw new ApiError('NOT_FOUND', 404, 'AWS invoice not found.');
        }
        assertAwsInvoiceRecordOwner(authorization.workspaceId, selectedMetadata);
        const selected = AwsInvoiceSchema.parse(
          await deps.getInvoiceObject(selectedMetadata.objectKey),
        );
        return jsonResponse(200, {
          dashboard: aggregateAwsInvoiceDashboard(selected, history),
        });
      }

      const yearMonthParam = pathParam(event, 'yearMonth');
      if (yearMonthParam) {
        const yearMonth = YearMonthSchema.parse(yearMonthParam);
        const record = await deps.getMetadata(
          authorization.workspaceId,
          yearMonth,
        );
        if (!record) {
          throw new ApiError('NOT_FOUND', 404, 'AWS invoice not found.');
        }
        assertAwsInvoiceRecordOwner(authorization.workspaceId, record);

        if (method === 'DELETE') {
          await deps.deleteInvoiceObject(record.objectKey);
          await deps.deleteMetadata(authorization.workspaceId, yearMonth);
          return jsonResponse(200, { yearMonth, deleted: true });
        }
        if (method === 'GET') {
          const parsed = AwsInvoiceSchema.parse(
            await deps.getInvoiceObject(record.objectKey),
          );
          return jsonResponse(200, { invoice: parsed });
        }
      }

      if (method === 'GET' && /\/aws\/invoices\/?$/.test(path)) {
        const cursor = parseCursor(queryParam(event, 'cursor'));
        const result = await deps.queryMetadata(
          authorization.workspaceId,
          cursor,
        );
        for (const item of result.items) {
          assertAwsInvoiceRecordOwner(authorization.workspaceId, item);
        }
        return jsonResponse(200, {
          items: result.items.map(metadataSummary),
          nextCursor: result.nextCursor
            ? encodeCursor(result.nextCursor)
            : null,
        });
      }

      throw new ApiError('NOT_FOUND', 404, 'AWS invoice route not found.');
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

export function createDefaultPresign(uploadBucket: string) {
  return async (params: {
    key: string;
    sha256Base64: string;
    contentType: string;
    size: number;
    expiresInSeconds: number;
  }): Promise<InvoicePresignResult> => {
    const expiresAt = new Date(
      Date.now() + params.expiresInSeconds * 1_000,
    ).toISOString();
    const command = new PutObjectCommand({
      Bucket: uploadBucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.size,
      ChecksumSHA256: params.sha256Base64,
    });
    const url = await getSignedUrl(s3Client, command, {
      expiresIn: params.expiresInSeconds,
    });
    // No x-amz-checksum-sha256 here: getSignedUrl puts ChecksumSHA256 in the
    // URL's query string because it is not a signed header, so a client that
    // also sends it as a header gets a 403 for signing an unsigned header. The
    // checksum is still enforced through the query parameter.
    return {
      url,
      headers: {
        'Content-Type': params.contentType,
      },
      expiresAt,
    };
  };
}

async function getInvoiceObject(
  bucket: string,
  objectKey: string,
): Promise<AwsInvoice> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
  );
  const body = await response.Body?.transformToByteArray();
  if (!body) {
    throw new ApiError('DATA_INTEGRITY_ERROR', 500, 'Empty invoice object.');
  }
  return parseAwsInvoiceObject(body);
}

async function deleteInvoiceObject(
  bucket: string,
  objectKey: string,
): Promise<void> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
  } catch (error) {
    if (
      error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404
    ) {
      return;
    }
    throw error;
  }
}

export async function handler(event: unknown): Promise<ApiResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const uploadBucket = requiredEnvironmentValue('UPLOAD_BUCKET');
  const statementsBucket = requiredEnvironmentValue('STATEMENTS_BUCKET');
  return createAwsInvoicesApiHandler({
    getAuthorizedUser: (sub) =>
      getAuthorizedUser(dynamoDocumentClient, tableName, sub),
    putJobRecord: (record) =>
      putAwsInvoiceUploadJobRecord(dynamoDocumentClient, tableName, record),
    getJobRecord: (jobId) =>
      getAwsInvoiceUploadJobRecord(dynamoDocumentClient, tableName, jobId),
    presign: createDefaultPresign(uploadBucket),
    queryMetadata: (workspaceId, cursor, limit) =>
      queryAwsInvoiceMetadata(
        dynamoDocumentClient,
        tableName,
        workspaceId,
        cursor,
        limit,
      ),
    getMetadata: (workspaceId, yearMonth) =>
      getAwsInvoiceMetadata(
        dynamoDocumentClient,
        tableName,
        workspaceId,
        yearMonth,
      ),
    getInvoiceObject: (objectKey) =>
      getInvoiceObject(statementsBucket, objectKey),
    deleteInvoiceObject: (objectKey) =>
      deleteInvoiceObject(statementsBucket, objectKey),
    deleteMetadata: (workspaceId, yearMonth) =>
      deleteAwsInvoiceMetadata(
        dynamoDocumentClient,
        tableName,
        workspaceId,
        yearMonth,
      ),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
  })(event);
}
