/**
 * OpenTelemetry bootstrap for the container runtime.
 *
 * Instrumentation is manual on purpose. Auto-instrumentation patches modules
 * at require time, which does not work inside an esbuild bundle, and it would
 * attach URLs and SDK request parameters to spans. Spans and metrics here carry
 * only the attributes the HTTP server and SQS consumer set explicitly.
 *
 * The exporters read OTEL_EXPORTER_OTLP_ENDPOINT themselves. With it unset
 * (Lambda, tests, local runs) nothing is registered and the OTel API no-ops.
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
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
    ],
  });
  tracerProvider.register();

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
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
