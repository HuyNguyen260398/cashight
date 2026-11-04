/**
 * OpenTelemetry bootstrap for the container runtime.
 *
 * Instrumentation is manual on purpose. Auto-instrumentation patches modules
 * at require time, which does not work inside an esbuild bundle, and it would
 * attach URLs and SDK request parameters to spans. Spans and metrics here carry
 * only the attributes the HTTP server and SQS consumer set explicitly.
 *
 * OTEL_EXPORTER_OTLP_ENDPOINT is read here and turned into explicit signal
 * URLs for the exporters (see otlpSignalUrl). With it unset (Lambda, tests,
 * local runs) nothing is registered and the OTel API no-ops.
 */
import { randomUUID } from 'node:crypto';

import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export interface Telemetry {
  enabled: boolean;
  /**
   * Export the current metrics now instead of at the next 30 s tick. Call it
   * once the instruments are zero-initialised and before serving: a counter
   * series whose first exported sample is already 1 shows no increase(), so
   * the alerts would miss the first error or failed job after a pod starts.
   * Never rejects, and gives up after timeoutMs so an unreachable collector
   * cannot hold up startup.
   */
  flush(timeoutMs?: number): Promise<void>;
  shutdown(): Promise<void>;
}

const FLUSH_TIMEOUT_MS = 5_000;

type Environment = Record<string, string | undefined>;

/** `<base>/v1/<signal>`, tolerating trailing slashes on the configured base. */
export function otlpSignalUrl(endpoint: string, signal: 'traces' | 'metrics'): string {
  return `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;
}

/**
 * Resource attributes for every signal. service.instance.id becomes the
 * `instance` metric label, so two replicas of one service write separate
 * series instead of interleaving one counter. Kubernetes sets HOSTNAME to the
 * pod name.
 */
export function telemetryResourceAttributes(
  serviceName: string,
  env: Environment = process.env,
): Record<string, string> {
  return {
    'service.name': serviceName,
    'service.namespace': 'cashight',
    'service.version': env.APP_VERSION?.trim() || 'unknown',
    'service.instance.id': env.HOSTNAME?.trim() || randomUUID(),
  };
}

export function startTelemetry(serviceName: string, env: Environment = process.env): Telemetry {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    return { enabled: false, flush: async () => undefined, shutdown: async () => undefined };
  }

  const resource = resourceFromAttributes(telemetryResourceAttributes(serviceName, env));

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpSignalUrl(endpoint, 'traces') })),
    ],
  });
  tracerProvider.register();

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: otlpSignalUrl(endpoint, 'metrics') }),
        exportIntervalMillis: 30_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    enabled: true,
    async flush(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
      try {
        await meterProvider.forceFlush({ timeoutMillis: timeoutMs });
      } catch {
        // The periodic export retries; a slow start beats a crash loop.
      }
    },
    async shutdown(): Promise<void> {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
