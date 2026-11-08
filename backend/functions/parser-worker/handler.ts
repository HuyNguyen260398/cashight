import { GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { parseStatementPdf } from '@cashight/domain/parsers';

import { dynamoDocumentClient, s3Client } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  getUploadJobRecord,
  transitionJobState,
  putIdempotencyRecord,
  putStatementMetadata,
} from '../../shared/metadata';
import { getSecretString } from '../../shared/secrets';
import { parseS3Notification } from '../../shared/s3-notification';
import { statementId } from '../../shared/storage';
import { MetricUnit, metrics } from '../../shared/observability';
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

    parsePdf: (buffer, passwords) => parseStatementPdf(buffer, passwords),

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

    writeMetadata: async ({ owner, statement, objectKey, sha256, uploadedAt }) => {
      const [year, month] = statement.statementDate.split('-').map(Number);
      const mm = String(month).padStart(2, '0');
      await putStatementMetadata(dynamoDocumentClient, tableName, {
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
    onLegacyFallback: () => {
      metrics.addMetric('LegacyWorkspaceFallback', MetricUnit.Count, 1);
    },
  });
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const uploadBucket = requiredEnvironmentValue('UPLOAD_BUCKET');
  const statementBucket = requiredEnvironmentValue('STATEMENTS_BUCKET');

  return createParserWorkerHandler(createProductionProcessJob(tableName, uploadBucket, statementBucket))(event);
}

export function createParserWorkerHandler(processJob: (s3Key: string) => Promise<void>) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: Array<{ itemIdentifier: string }> = [];

    for (const record of event.Records) {
      try {
        const message = parseS3Notification(record.body);
        if (message.kind === 'test') {
          console.info({ messageId: record.messageId, skipped: 's3:TestEvent' });
          continue;
        }
        await processJob(message.key);
      } catch (err) {
        console.error({ messageId: record.messageId, err: (err as Error).message });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
}
