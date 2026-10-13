import { describe, expect, it } from 'vitest';

import { otlpSignalUrl, startTelemetry } from '../server/telemetry';

describe('startTelemetry', () => {
  it('is a no-op when no OTLP endpoint is configured', async () => {
    const telemetry = startTelemetry('cashight-api', {});
    expect(telemetry.enabled).toBe(false);
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('treats a blank endpoint as unset', () => {
    expect(startTelemetry('cashight-api', { OTEL_EXPORTER_OTLP_ENDPOINT: '  ' }).enabled).toBe(false);
  });

  it('starts and shuts down cleanly even when the collector is unreachable', async () => {
    const telemetry = startTelemetry('cashight-api', {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
    });
    expect(telemetry.enabled).toBe(true);
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

describe('otlpSignalUrl', () => {
  it.each([
    'http://otel-gateway.observability:4318',
    'http://otel-gateway.observability:4318/',
    'http://otel-gateway.observability:4318///',
  ])('appends the signal path to %s without doubling slashes', (endpoint) => {
    expect(otlpSignalUrl(endpoint, 'traces')).toBe(
      'http://otel-gateway.observability:4318/v1/traces',
    );
    expect(otlpSignalUrl(endpoint, 'metrics')).toBe(
      'http://otel-gateway.observability:4318/v1/metrics',
    );
  });
});
