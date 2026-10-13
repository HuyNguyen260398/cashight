/**
 * Queue front end for the worker handlers when they run in a container.
 *
 * It stands in for the Lambda SQS event source mapping (batch size 1,
 * ReportBatchItemFailures): poll, hand one record to the unchanged handler,
 * delete on success, and leave failures for SQS to redeliver and eventually
 * move to the DLQ.
 */
import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { SpanStatusCode, metrics as otelMetrics, trace } from '@opentelemetry/api';

import { logger } from '../shared/observability';

export interface QueueRecord {
  messageId: string;
  body: string;
}

export type BatchHandler = (event: {
  Records: QueueRecord[];
}) => Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }>;

export interface SqsConsumerOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK's send() overloads do not narrow through a structural type
  client: { send(command: any, options?: { abortSignal?: AbortSignal }): Promise<any> };
  queueUrl: string;
  handler: BatchHandler;
  /** Hard limit per job, mirroring the Lambda timeout. Must stay below the queue's visibility timeout. */
  maxProcessingMs: number;
  /** Called once when a job exceeds maxProcessingMs. The process should exit. */
  onFatal: (error: Error) => void;
  waitTimeSeconds?: number;
  errorBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SqsConsumer {
  /** Resolves when the loop has stopped and any in-flight job has finished. */
  start(): Promise<void>;
  stop(): void;
}

type Outcome = 'succeeded' | 'failed' | 'timed_out';

const TIMED_OUT = Symbol('timed-out');

export function createSqsConsumer(options: SqsConsumerOptions): SqsConsumer {
  const {
    client,
    queueUrl,
    handler,
    maxProcessingMs,
    onFatal,
    waitTimeSeconds = 20,
    errorBackoffMs = 5_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  // Created here, not at module scope: see backend/server/telemetry.ts.
  const meter = otelMetrics.getMeter('cashight');
  const jobs = meter.createCounter('cashight.worker.jobs');
  const duration = meter.createHistogram('cashight.worker.job.duration', { unit: 's' });
  const tracer = trace.getTracer('cashight');

  let stopped = false;
  const pollAbort = new AbortController();

  async function runJob(record: QueueRecord, receiptHandle: string): Promise<Outcome> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), maxProcessingMs);
    });

    try {
      const result = await Promise.race([handler({ Records: [record] }), timeout]);
      if (result === TIMED_OUT) return 'timed_out';
      if (result.batchItemFailures.length > 0) return 'failed';
      await client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
      );
      return 'succeeded';
    } catch (error) {
      logger.error('job threw', {
        messageId: record.messageId,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleMessage(message: {
    MessageId?: string;
    Body?: string;
    ReceiptHandle?: string;
  }): Promise<void> {
    const { MessageId: messageId, Body: body, ReceiptHandle: receiptHandle } = message;
    if (!messageId || !body || !receiptHandle) {
      logger.warn('skipping malformed queue message', { messageId: messageId ?? 'unknown' });
      return;
    }

    const started = Date.now();
    await tracer.startActiveSpan('worker.job', async (span) => {
      const outcome = await runJob({ messageId, body }, receiptHandle);
      const seconds = (Date.now() - started) / 1000;
      span.setAttribute('cashight.worker.outcome', outcome);
      if (outcome !== 'succeeded') span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      jobs.add(1, { outcome });
      duration.record(seconds, { outcome });
      logger.info('job', { messageId, outcome, durationMs: Math.round(seconds * 1000) });

      if (outcome === 'timed_out') {
        stopped = true;
        onFatal(new Error(`Job exceeded ${maxProcessingMs} ms; exiting so the message is redelivered.`));
      }
    });
  }

  return {
    async start(): Promise<void> {
      while (!stopped) {
        let messages: Array<{ MessageId?: string; Body?: string; ReceiptHandle?: string }>;
        try {
          const response = await client.send(
            new ReceiveMessageCommand({
              QueueUrl: queueUrl,
              MaxNumberOfMessages: 1,
              WaitTimeSeconds: waitTimeSeconds,
            }),
            { abortSignal: pollAbort.signal },
          );
          messages = response.Messages ?? [];
        } catch (error) {
          if (stopped) break;
          logger.error('receive failed', {
            errorName: error instanceof Error ? error.name : 'unknown',
          });
          await sleep(errorBackoffMs);
          continue;
        }

        for (const message of messages) {
          await handleMessage(message);
        }
      }
    },

    stop(): void {
      stopped = true;
      pollAbort.abort();
    },
  };
}
