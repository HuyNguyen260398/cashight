import { sqsClient } from '../shared/clients';
import { requiredEnvironmentValue } from '../shared/config';
import { logger } from '../shared/observability';
import { createSqsConsumer, type BatchHandler } from './sqs-consumer';
import { startTelemetry } from './telemetry';

type Environment = Record<string, string | undefined>;

/** terraform/data.tf sets visibility_timeout_seconds = 360 on both queues. */
const QUEUE_VISIBILITY_TIMEOUT_SECONDS = 360;

export function workerConfigFromEnv(env: Environment = process.env) {
  const queueUrl = requiredEnvironmentValue('QUEUE_URL', env);
  const raw = requiredEnvironmentValue('MAX_PROCESSING_SECONDS', env);
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(seconds > 0) || seconds >= QUEUE_VISIBILITY_TIMEOUT_SECONDS) {
    throw new Error('Invalid configuration: MAX_PROCESSING_SECONDS');
  }
  return { queueUrl, maxProcessingMs: seconds * 1000 };
}

export async function startWorkerService(
  serviceName: string,
  handler: BatchHandler,
): Promise<void> {
  const config = workerConfigFromEnv();
  const telemetry = startTelemetry(serviceName);

  let exitCode = 0;
  const consumer = createSqsConsumer({
    client: sqsClient,
    queueUrl: config.queueUrl,
    handler,
    maxProcessingMs: config.maxProcessingMs,
    onFatal: (error) => {
      logger.error('fatal worker error', { reason: error.message });
      exitCode = 1;
    },
  });

  const stop = (signal: string): void => {
    logger.info('shutting down', { signal });
    consumer.stop();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  logger.info('consuming', { serviceName, telemetry: telemetry.enabled });
  await consumer.start();
  await telemetry.shutdown();
  // A timed-out job is still running; exiting is what releases it.
  process.exit(exitCode);
}
