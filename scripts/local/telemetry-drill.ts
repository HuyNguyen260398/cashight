/**
 * Telemetry drill: run Plan 1's real container-runtime instrumentation with
 * fake dependencies, so metrics, spans and logs reach a local OpenTelemetry
 * Collector (aws-eks-infra scripts/run-local-collector.sh) without AWS.
 *
 * Why not `pnpm dev:local`: scripts/dev-server.ts reuses the route table but
 * never starts telemetry, createApiServer or createSqsConsumer, so it emits no
 * OTLP at all. Here the four service names of backend/server/entrypoints run
 * in four child processes (OTel providers are process-global):
 *
 *   cashight-api, cashight-aws-api      createApiServer, accepting any bearer
 *                                       token; GET /statements always answers
 *                                       500, everything else 200
 *   cashight-parser-worker,             createSqsConsumer over a fake SQS
 *   cashight-invoice-parser-worker      client: one message every 10 s;
 *                                       --failed-jobs fail from job 5 on
 *
 * The parent sends --rps requests per second for --minutes; --error-ratio of
 * them go to /statements. Handlers log email and description fields on
 * purpose: Cashight's logger must drop them, and telemetry-audit.ts checks
 * that it did. Logs go to stdout and are appended to --log-file, which the
 * local collector tails.
 *
 * Usage:
 *   pnpm tsx scripts/local/telemetry-drill.ts --minutes 3 --rps 1 \
 *     --error-ratio 0.1 --failed-jobs 1 --log-file "$LOG_DIR/drill.log"
 *
 * Never deployed. Nothing here is imported by the app or the Lambda bundles.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

import { jsonResponse } from '../../backend/shared/api-response';
import { logger } from '../../backend/shared/observability';
import { createApiServer, type ApiHandler } from '../../backend/server/http-server';
import { createRateLimiter } from '../../backend/server/rate-limit';
import { createSqsConsumer } from '../../backend/server/sqs-consumer';
import { startTelemetry } from '../../backend/server/telemetry';

const API_ROLES = ['cashight-api', 'cashight-aws-api'] as const;
const WORKER_ROLES = ['cashight-parser-worker', 'cashight-invoice-parser-worker'] as const;
type Role = (typeof API_ROLES)[number] | (typeof WORKER_ROLES)[number];

const { values: args } = parseArgs({
  options: {
    minutes: { type: 'string', default: '3' },
    rps: { type: 'string', default: '1' },
    'error-ratio': { type: 'string', default: '0' },
    'failed-jobs': { type: 'string', default: '0' },
    'log-file': { type: 'string' },
    role: { type: 'string' },
  },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function teeStdout(logFile: string | undefined): void {
  if (!logFile) return;
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: never[]) => {
    appendFileSync(logFile, chunk);
    return write(chunk, ...rest);
  }) as typeof process.stdout.write;
}

// ── Child: one service ────────────────────────────────────────────────────────

function ok(route: string): ApiHandler {
  return async () => {
    logger.info('drill request', {
      route,
      email: 'drill@example.com',
      description: 'GRAB*1234 4111111111111111',
    });
    return jsonResponse(200, {});
  };
}

const failing: ApiHandler = async () => {
  logger.error('drill failure', { route: 'statements' });
  return jsonResponse(500, { error: { code: 'DRILL', message: 'drill failure' } });
};

async function runApi(role: Role): Promise<() => Promise<void>> {
  const handlers =
    role === 'cashight-api'
      ? { dashboard: ok('dashboard'), statements: failing }
      : { costExplorer: ok('costExplorer') };
  const server = createApiServer({
    handlers,
    verifier: { verify: async () => ({ sub: 'drill', token_use: 'access', scope: 'drill' }) },
    rateLimiter: createRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.send?.({ port: (server.address() as AddressInfo).port });
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

// Job 5 arrives about 40 s in, after the first 30 s metric export has sent the
// failure counter at 0. A failure before that export reaches Prometheus as a
// series born at 1, which increase() cannot see.
const FIRST_FAILING_JOB = 5;

async function runWorker(failedJobs: number): Promise<() => Promise<void>> {
  let sent = 0;
  let nextAt = Date.now();
  const consumer = createSqsConsumer({
    client: {
      async send(command: unknown) {
        if (command instanceof DeleteMessageCommand) return {};
        if (!(command instanceof ReceiveMessageCommand)) return {};
        if (Date.now() < nextAt) {
          await sleep(1_000);
          return {};
        }
        nextAt = Date.now() + 10_000;
        sent += 1;
        return { Messages: [{ MessageId: `drill-${sent}`, Body: '{}', ReceiptHandle: `rh-${sent}` }] };
      },
    },
    queueUrl: 'https://sqs.local/drill',
    handler: async (event) => {
      logger.info('drill job', { messageId: event.Records[0]?.messageId });
      const n = Number(event.Records[0]?.messageId.split('-')[1]);
      const fail = n >= FIRST_FAILING_JOB && n < FIRST_FAILING_JOB + failedJobs;
      return {
        batchItemFailures: fail ? event.Records.map((r) => ({ itemIdentifier: r.messageId })) : [],
      };
    },
    maxProcessingMs: 30_000,
    onFatal: () => process.exit(1),
    waitTimeSeconds: 0,
  });
  const running = consumer.start();
  process.send?.({ ready: true });
  return async () => {
    consumer.stop();
    await running;
  };
}

async function child(role: Role): Promise<void> {
  teeStdout(args['log-file']);
  const telemetry = startTelemetry(role, {
    ...process.env,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
  });
  const stop = (API_ROLES as readonly string[]).includes(role)
    ? await runApi(role)
    : await runWorker(Number(args['failed-jobs']));
  process.on('message', (message) => {
    if (message !== 'stop') return;
    void (async () => {
      await stop();
      await telemetry.shutdown();
      process.exit(0);
    })();
  });
}

// ── Parent: traffic ───────────────────────────────────────────────────────────

function start(role: Role): Promise<{ proc: ChildProcess; port?: number }> {
  const forwarded = ['--role', role, '--failed-jobs', args['failed-jobs'] ?? '0'];
  if (args['log-file']) forwarded.push('--log-file', args['log-file']);
  const proc = fork(fileURLToPath(import.meta.url), forwarded, { execArgv: process.execArgv });
  return new Promise((resolve, reject) => {
    proc.once('message', (message: { port?: number }) => resolve({ proc, port: message.port }));
    proc.once('exit', (code) => reject(new Error(`${role} exited with ${code} before it was ready`)));
  });
}

async function parent(): Promise<void> {
  const minutes = Number(args.minutes);
  const rps = Number(args.rps);
  const errorRatio = Number(args['error-ratio']);
  if (!(minutes > 0) || !(rps > 0) || !(errorRatio >= 0 && errorRatio <= 1)) {
    throw new Error('--minutes and --rps must be > 0, --error-ratio within 0..1');
  }

  const children = await Promise.all([...API_ROLES, ...WORKER_ROLES].map((role) => start(role)));
  const [api, awsApi] = children;
  const deadline = Date.now() + minutes * 60_000;
  const counts = { ok: 0, errors: 0, failedRequests: 0 };

  for (let tick = 0; Date.now() < deadline; tick += 1) {
    const toStatements = Math.random() < errorRatio;
    const target =
      tick % 5 === 4
        ? `http://127.0.0.1:${awsApi?.port}/aws/cost-explorer/summary`
        : `http://127.0.0.1:${api?.port}/${toStatements ? 'statements' : 'dashboard'}`;
    try {
      const response = await fetch(target, { headers: { Authorization: 'Bearer drill' } });
      await response.arrayBuffer();
      if (response.status >= 500) counts.errors += 1;
      else counts.ok += 1;
    } catch {
      counts.failedRequests += 1;
    }
    await sleep(1_000 / rps);
  }

  await Promise.all(
    children.map(
      ({ proc }) =>
        new Promise<void>((resolve) => {
          proc.removeAllListeners('exit');
          proc.once('exit', () => resolve());
          proc.send('stop');
        }),
    ),
  );
  console.error(`drill done: ${JSON.stringify(counts)}`);
  if (counts.failedRequests > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const role = args.role as Role | undefined;
  void (role ? child(role) : parent()).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
