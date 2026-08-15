import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { parseAwsInvoicePdf } from '@cashight/domain/parsers/aws-invoice';

import { dynamoDocumentClient, s3Client } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  claimAwsInvoiceUploadJob,
  getAwsInvoiceMetadata,
  getAwsInvoiceUploadJobRecord,
  putAwsInvoiceMetadata,
  transitionAwsInvoiceJobState,
} from '../../shared/metadata';
import { parseAwsInvoiceObject } from '../../shared/storage';
import { computeSha256, createInvoiceProcessJob } from './process-job';

export interface InvoiceQueueRecord {
  messageId: string;
  body: string;
}

interface InvoiceQueueEvent {
  Records: InvoiceQueueRecord[];
}

interface S3Notification {
  Records?: Array<{ s3?: { object?: { key?: string } } }>;
}

interface InvoiceQueueBatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

type AwsInvoiceParseFailureCode =
  | 'UNSUPPORTED_AWS_INVOICE'
  | 'INVOICE_TOTAL_MISMATCH'
  | 'INVALID_PDF'
  | 'CHECKSUM_MISMATCH';

export function emitAwsInvoiceParseFailureMetric(
  errorCode: AwsInvoiceParseFailureCode,
  functionName =
    process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'cashight-invoice-parser-worker',
  timestamp = Date.now(),
  writeMetric: (value: string) => void = console.log,
): void {
  writeMetric(
    JSON.stringify({
      _aws: {
        Timestamp: timestamp,
        CloudWatchMetrics: [
          {
            Namespace: 'Cashight',
            Dimensions: [['FunctionName', 'ErrorCode']],
            Metrics: [{ Name: 'AwsInvoiceParseFailure', Unit: 'Count' }],
          },
        ],
      },
      FunctionName: functionName,
      ErrorCode: errorCode,
      AwsInvoiceParseFailure: 1,
    }),
  );
}

function extractS3Key(body: string): string {
  const notification = JSON.parse(body) as S3Notification;
  const key = notification.Records?.[0]?.s3?.object?.key;
  if (!key) throw new Error('Invoice notification has no object key.');
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

export function createInvoiceParserWorkerHandler(
  processJob: (key: string, claimId: string) => Promise<void>,
) {
  return async (
    event: InvoiceQueueEvent,
  ): Promise<InvoiceQueueBatchResponse> => {
    const batchItemFailures: Array<{ itemIdentifier: string }> = [];
    for (const record of event.Records) {
      try {
        await processJob(extractS3Key(record.body), record.messageId);
      } catch (error) {
        console.error({
          messageId: record.messageId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

async function readObject(bucket: string, key: string): Promise<Buffer> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = await response.Body?.transformToByteArray();
  if (!body) throw new Error('S3 object body is empty.');
  return Buffer.from(body);
}

async function getDestinationInvoice(
  bucket: string,
  key: string,
) {
  try {
    return parseAwsInvoiceObject(await readObject(bucket, key));
  } catch (error) {
    if (
      error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404
    ) {
      return undefined;
    }
    if (error instanceof Error && error.name === 'NoSuchKey') return undefined;
    throw error;
  }
}

export async function handler(
  event: InvoiceQueueEvent,
): Promise<InvoiceQueueBatchResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const uploadBucket = requiredEnvironmentValue('UPLOAD_BUCKET');
  const statementsBucket = requiredEnvironmentValue('STATEMENTS_BUCKET');
  const processJob = createInvoiceProcessJob({
    getJobRecord: (jobId) =>
      getAwsInvoiceUploadJobRecord(dynamoDocumentClient, tableName, jobId),
    claimJob: (jobId, claimId) =>
      claimAwsInvoiceUploadJob(
        dynamoDocumentClient,
        tableName,
        jobId,
        claimId,
        new Date().toISOString(),
      ),
    transitionToTerminal: async (jobId, state, extra) => {
      await transitionAwsInvoiceJobState(
        dynamoDocumentClient,
        tableName,
        jobId,
        'PROCESSING',
        state,
        new Date().toISOString(),
        extra,
      );
      if (
        state === 'FAILED' &&
        extra?.errorCode &&
        extra.errorCode !== 'INVOICE_CONFLICT'
      ) {
        emitAwsInvoiceParseFailureMetric(extra.errorCode);
      }
    },
    downloadPdf: (key) => readObject(uploadBucket, key),
    deletePdf: (key) =>
      s3Client
        .send(new DeleteObjectCommand({ Bucket: uploadBucket, Key: key }))
        .then(() => undefined),
    computeSha256,
    parsePdf: parseAwsInvoicePdf,
    getMetadata: (workspaceId, yearMonth) =>
      getAwsInvoiceMetadata(
        dynamoDocumentClient,
        tableName,
        workspaceId,
        yearMonth,
      ),
    getDestinationInvoice: (key) =>
      getDestinationInvoice(statementsBucket, key),
    writeInvoice: (key, invoice) =>
      s3Client
        .send(
          new PutObjectCommand({
            Bucket: statementsBucket,
            Key: key,
            Body: JSON.stringify(invoice),
            ContentType: 'application/json',
          }),
        )
        .then(() => undefined),
    writeMetadata: (record) =>
      putAwsInvoiceMetadata(dynamoDocumentClient, tableName, record),
  });
  return createInvoiceParserWorkerHandler(processJob)(event);
}
