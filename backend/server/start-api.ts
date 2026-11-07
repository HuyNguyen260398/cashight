import { logger } from '../shared/observability';
import { installProcessErrorHandlers } from './process-errors';
import { createApiServer, type ApiHandler } from './http-server';
import { createAccessTokenVerifier, verifierConfigFromEnv } from './jwt';
import { createRateLimiter } from './rate-limit';
import { assertRequiredEnv } from './required-env';
import type { HandlerName } from './routes';
import { createApiShutdown } from './shutdown';
import { startTelemetry } from './telemetry';

type Environment = Record<string, string | undefined>;

function integerFromEnv(env: Environment, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`Invalid configuration: ${name}`);
  return Number(raw.trim());
}

export function apiConfigFromEnv(env: Environment = process.env) {
  return {
    port: integerFromEnv(env, 'PORT', 8080),
    // Defaults mirror the API Gateway stage throttle in terraform/api.tf.
    rateLimitBurst: integerFromEnv(env, 'RATE_LIMIT_BURST', 50),
    rateLimitPerSecond: integerFromEnv(env, 'RATE_LIMIT_PER_SECOND', 100),
    // Time for the load balancer to stop routing here after readiness fails.
    shutdownDelayMs: integerFromEnv(env, 'SHUTDOWN_DELAY_MS', 5_000),
    // API Gateway's integration limit, which the Lambdas lived under.
    requestTimeoutMs: integerFromEnv(env, 'REQUEST_TIMEOUT_MS', 29_000),
    // Bound on how long in-flight requests may hold a shutting-down pod.
    shutdownHardDeadlineMs: integerFromEnv(env, 'SHUTDOWN_HARD_DEADLINE_MS', 10_000),
  };
}

export async function startApiService(
  serviceName: string,
  handlers: Partial<Record<HandlerName, ApiHandler>>,
  requiredEnv: readonly string[],
): Promise<void> {
  installProcessErrorHandlers({
    on: (event, listener) => process.on(event, listener),
    log: logger.error,
    exit: (code) => process.exit(code),
  });
  assertRequiredEnv(requiredEnv);
  const config = apiConfigFromEnv();
  const verifierConfig = verifierConfigFromEnv();
  // Telemetry first: instruments created before it are permanent no-ops.
  const telemetry = startTelemetry(serviceName);

  let ready = true;
  const server = createApiServer({
    handlers,
    verifier: createAccessTokenVerifier(verifierConfig),
    rateLimiter: createRateLimiter({
      capacity: config.rateLimitBurst,
      refillPerSecond: config.rateLimitPerSecond,
    }),
    isReady: () => ready,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  const shutdown = createApiShutdown({
    server,
    setNotReady: () => {
      ready = false;
    },
    flushTelemetry: () => telemetry.shutdown(),
    delayMs: config.shutdownDelayMs,
    hardDeadlineMs: config.shutdownHardDeadlineMs,
    log: logger.info,
    exit: (code) => process.exit(code),
  });
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Export the zero-initialised response counter before taking traffic, so
  // the first 5xx on a new pod counts toward the API errors alert.
  await telemetry.flush();
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  logger.info('listening', {
    serviceName,
    port: config.port,
    routes: Object.keys(handlers).join(','),
    telemetry: telemetry.enabled,
  });
}
