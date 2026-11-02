import { describe, expect, it } from 'vitest';

import { otlpSignalUrl, startTelemetry, telemetryResourceAttributes } from '../server/telemetry';

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

// Two replicas of one service must not write the same metric series: each
// process carries its own service.instance.id, which becomes `instance`.
describe('telemetryResourceAttributes', () => {
  it('uses the pod name (HOSTNAME) as the instance id', () => {
    expect(telemetryResourceAttributes('cashight-api', { HOSTNAME: 'cashight-api-7d9f-abcde' })).toEqual({
      'service.name': 'cashight-api',
      'service.namespace': 'cashight',
      'service.version': 'unknown',
      'service.instance.id': 'cashight-api-7d9f-abcde',
    });
  });

  it('falls back to a distinct id per process without HOSTNAME', () => {
    const a = telemetryResourceAttributes('cashight-api', {})['service.instance.id'];
    const b = telemetryResourceAttributes('cashight-api', { HOSTNAME: ' ' })['service.instance.id'];
    expect(a).toMatch(/\S/);
    expect(a).not.toBe(b);
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
