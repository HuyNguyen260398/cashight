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
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export interface Telemetry {
  enabled: boolean;
  shutdown(): Promise<void>;
}

type Environment = Record<string, string | undefined>;

/** `<base>/v1/<signal>`, tolerating trailing slashes on the configured base. */
export function otlpSignalUrl(endpoint: string, signal: 'traces' | 'metrics'): string {
  return `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;
}

export function startTelemetry(serviceName: string, env: Environment = process.env): Telemetry {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return { enabled: false, shutdown: async () => undefined };

  const resource = resourceFromAttributes({
    'service.name': serviceName,
    'service.namespace': 'cashight',
    'service.version': env.APP_VERSION?.trim() || 'unknown',
  });

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
    async shutdown(): Promise<void> {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
