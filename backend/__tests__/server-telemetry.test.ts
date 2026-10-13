import { describe, expect, it } from 'vitest';

import { startTelemetry } from '../server/telemetry';

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
