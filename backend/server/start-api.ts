import { logger } from '../shared/observability';
import { createApiServer, type ApiHandler } from './http-server';
import { createAccessTokenVerifier, verifierConfigFromEnv } from './jwt';
import { createRateLimiter } from './rate-limit';
import type { HandlerName } from './routes';
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
  };
}

export async function startApiService(
  serviceName: string,
  handlers: Partial<Record<HandlerName, ApiHandler>>,
): Promise<void> {
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
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    logger.info('shutting down', { signal });
    setTimeout(() => {
      server.close(() => {
        void telemetry.shutdown().finally(() => process.exit(0));
      });
      server.closeIdleConnections();
    }, config.shutdownDelayMs);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  logger.info('listening', {
    serviceName,
    port: config.port,
    routes: Object.keys(handlers).join(','),
    telemetry: telemetry.enabled,
  });
}
