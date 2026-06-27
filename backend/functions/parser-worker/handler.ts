import { GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { parseTPBankStatement } from '@cashight/domain/parsers/tpbank';

import { dynamoDocumentClient, s3Client } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  getUploadJobRecord,
  transitionJobState,
  putIdempotencyRecord,
  putStatementMetadata,
} from '../../shared/metadata';
import { getSecretString } from '../../shared/secrets';
import { statementId } from '../../shared/storage';
import { createProcessJob, computeSha256 } from './process-job';

interface SQSRecord {
  messageId: string;
  body: string;
}

interface SQSEvent {
  Records: SQSRecord[];
}

interface SQSBatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

interface S3Notification {
  Records?: Array<{
    s3?: {
      object?: { key?: string };
    };
  }>;
}

function extractS3Key(body: string): string {
  const notification = JSON.parse(body) as S3Notification;
  const key = notification.Records?.[0]?.s3?.object?.key;
  if (!key) throw new Error('No S3 key in notification');
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

function createProductionProcessJob(tableName: string, uploadBucket: string, statementBucket: string) {
  return createProcessJob({
    getJobRecord: (jobId) => getUploadJobRecord(dynamoDocumentClient, tableName, jobId),

    transitionToProcessing: (jobId) =>
      transitionJobState(
        dynamoDocumentClient,
        tableName,
        jobId,
        'PENDING_UPLOAD',
        'PROCESSING',
        new Date().toISOString(),
        {},
      ),

    putIdempotencyRecord: (jobId, sha256Hash) =>
      putIdempotencyRecord(
        dynamoDocumentClient,
        tableName,
        jobId,
        sha256Hash,
        Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      ),

    transitionToTerminal: (jobId, state, extra = {}) =>
      transitionJobState(
        dynamoDocumentClient,
        tableName,
        jobId,
        'PROCESSING',
        state,
        new Date().toISOString(),
        extra,
      ).then(() => undefined),

    downloadPdf: async (key) => {
      const res = await s3Client.send(
        new GetObjectCommand({ Bucket: uploadBucket, Key: key }),
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    deletePdf: (key) =>
      s3Client.send(new DeleteObjectCommand({ Bucket: uploadBucket, Key: key })).then(() => undefined),

    getSecret: (secretId) => getSecretString(secretId),

    parsePdf: (buffer, password) => parseTPBankStatement(buffer, password),

    checkDestinationExists: async (key) => {
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: statementBucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },

    writeStatement: async (key, statement) => {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: statementBucket,
          Key: key,
          Body: JSON.stringify(statement),
          ContentType: 'application/json',
        }),
      );
    },

    writeMetadata: async ({ sub, statement, objectKey, sha256, uploadedAt }) => {
      const [year, month] = statement.statementDate.split('-').map(Number);
      const mm = String(month).padStart(2, '0');
      await putStatementMetadata(dynamoDocumentClient, tableName, {
        PK: `USER#${sub}`,
        SK: `STATEMENT#${year}-${mm}#${statement.cardLast4}`,
        statementId: statementId(statement.cardLast4, year, month),
        objectKey,
        cardLast4: statement.cardLast4,
        statementDate: statement.statementDate,
        totalSpend: statement.totals.totalSpend,
        transactionCount: statement.transactions.length,
        sha256,
        uploadedAt,
      });
    },

    computeSha256,
    now: () => new Date(),
  });
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const uploadBucket = requiredEnvironmentValue('UPLOAD_BUCKET');
  const statementBucket = requiredEnvironmentValue('STATEMENTS_BUCKET');

  const processJob = createProductionProcessJob(tableName, uploadBucket, statementBucket);
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      const s3Key = extractS3Key(record.body);
      await processJob(s3Key);
    } catch (err) {
      console.error({ messageId: record.messageId, err: (err as Error).message });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
