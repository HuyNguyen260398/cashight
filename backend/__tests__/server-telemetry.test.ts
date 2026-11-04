import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { metrics } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';

import { otlpSignalUrl, startTelemetry, telemetryResourceAttributes } from '../server/telemetry';

describe('startTelemetry', () => {
  it('is a no-op when no OTLP endpoint is configured', async () => {
    const telemetry = startTelemetry('cashight-api', {});
    expect(telemetry.enabled).toBe(false);
    await expect(telemetry.flush()).resolves.toBeUndefined();
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
    await expect(telemetry.flush(1_000)).resolves.toBeUndefined();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  // A counter zero-initialised at startup only helps if that zero reaches
  // Prometheus before the first increment; the periodic export is 30 s away.
  it('flush exports the current metrics immediately', async () => {
    const posts: string[] = [];
    const collector = http.createServer((request, response) => {
      posts.push(request.url ?? '');
      request.resume();
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    const { port } = collector.address() as AddressInfo;

    metrics.disable();
    const telemetry = startTelemetry('cashight-api', { OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}` });
    try {
      metrics.getMeter('test').createCounter('test.zero').add(0, { outcome: 'failed' });
      await telemetry.flush();
      expect(posts).toContain('/v1/metrics');
    } finally {
      await telemetry.shutdown();
      metrics.disable();
      await new Promise((resolve) => collector.close(resolve));
    }
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
