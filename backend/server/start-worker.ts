import { sqsClient } from '../shared/clients';
import { requiredEnvironmentValue } from '../shared/config';
import { logger } from '../shared/observability';
import { installProcessErrorHandlers } from './process-errors';
import { assertRequiredEnv } from './required-env';
import { createSqsConsumer, type BatchHandler } from './sqs-consumer';
import { workerExitCode } from './shutdown';
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
  requiredEnv: readonly string[],
): Promise<void> {
  installProcessErrorHandlers({
    on: (event, listener) => process.on(event, listener),
    log: logger.error,
    exit: (code) => process.exit(code),
  });
  // Queue settings first so their error messages stay as they were.
  const config = workerConfigFromEnv();
  assertRequiredEnv(requiredEnv);
  const telemetry = startTelemetry(serviceName);

  const state = { fatal: false };
  const consumer = createSqsConsumer({
    client: sqsClient,
    queueUrl: config.queueUrl,
    handler,
    maxProcessingMs: config.maxProcessingMs,
    onFatal: (error) => {
      logger.error('fatal worker error', { reason: error.message });
      state.fatal = true;
    },
  });

  const stop = (signal: string): void => {
    logger.info('shutting down', { signal });
    consumer.stop();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // The consumer zero-initialised its job counter; export that before the
  // first job so a failure on a freshly scaled-up pod is an increase().
  await telemetry.flush();
  logger.info('consuming', { serviceName, telemetry: telemetry.enabled });
  await consumer.start();
  await telemetry.shutdown();
  // A timed-out job is still running; exiting is what releases it.
  process.exit(workerExitCode(state));
}
