import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../shared/api-response';
import { createApiServer, statusClass } from '../server/http-server';

class TestReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

let reader: TestReader;
let server: http.Server | undefined;

beforeEach(() => {
  // Instruments bind to the global provider when created, so it is set
  // before createApiServer runs.
  metrics.disable();
  reader = new TestReader();
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
  metrics.disable();
});

/** `outcome` -> value of cashight.http.server.responses at this instant. */
async function responses(): Promise<Record<string, number>> {
  const { resourceMetrics } = await reader.collect();
  const metric = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((m) => m.descriptor.name === 'cashight.http.server.responses');
  const points = (metric?.dataPoints ?? []) as Array<DataPoint<number>>;
  return Object.fromEntries(points.map((p) => [String(p.attributes.outcome), p.value]));
}

async function start(): Promise<string> {
  server = createApiServer({
    handlers: {
      dashboard: async () => jsonResponse(200, { ok: true }),
      statements: async () => jsonResponse(500, { error: { code: 'X', message: 'x' } }),
    },
    verifier: { verify: async () => ({ sub: 'u', token_use: 'access', scope: 's' }) },
    rateLimiter: { take: () => true },
  });
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

// The API errors alert takes increase() of this counter. A series first
// exported at 1 shows no increase, so the first 5xx on a new pod would be lost
// unless every class exists at 0 from startup.
describe('cashight.http.server.responses', () => {
  it('exists at zero for every status class before any request', async () => {
    await start();
    expect(await responses()).toEqual({ '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 });
  });

  it('counts the first 5xx on top of the zero series', async () => {
    const base = await start();
    const headers = { Authorization: 'Bearer t' };
    await (await fetch(`${base}/statements`, { headers })).arrayBuffer();
    await (await fetch(`${base}/dashboard`, { headers })).arrayBuffer();
    await (await fetch(`${base}/nope`, { headers })).arrayBuffer();
    // The counter is recorded after the response is written.
    await vi.waitFor(async () => {
      expect(await responses()).toEqual({ '2xx': 1, '3xx': 0, '4xx': 1, '5xx': 1 });
    });
  });

  it('keeps probes out of the counter', async () => {
    const base = await start();
    await (await fetch(`${base}/healthz`)).arrayBuffer();
    expect(await responses()).toEqual({ '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 });
  });
});

describe('statusClass', () => {
  it.each([
    [200, '2xx'],
    [204, '2xx'],
    [302, '3xx'],
    [404, '4xx'],
    [429, '4xx'],
    [500, '5xx'],
    [503, '5xx'],
    [0, '5xx'],
  ] as const)('classifies %i as %s', (status, expected) => {
    expect(statusClass(status)).toBe(expected);
  });
});
