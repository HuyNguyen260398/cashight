import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MetricUnit,
  logger,
  metricInstrumentName,
  metrics,
} from '../shared/observability';

describe('metricInstrumentName', () => {
  it.each([
    ['LegacyWorkspaceFallback', 'cashight.legacy_workspace_fallback'],
    ['LegacyAuthzFallback', 'cashight.legacy_authz_fallback'],
    ['AwsInvoiceParseFailure', 'cashight.aws_invoice_parse_failure'],
  ])('%s → %s', (name, expected) => {
    expect(metricInstrumentName(name)).toBe(expected);
  });
});

describe('metrics.addMetric', () => {
  it('is safe to call with no telemetry provider registered', () => {
    expect(() => metrics.addMetric('LegacyWorkspaceFallback', MetricUnit.Count, 1)).not.toThrow();
  });
});

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  function capture(): () => Record<string, unknown> {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    return () => JSON.parse(String(write.mock.calls[0][0])) as Record<string, unknown>;
  }

  it('writes one JSON line with level, message and service', () => {
    const read = capture();
    logger.info('request', { route: 'dashboard', status: 200 });
    expect(read()).toMatchObject({
      level: 'info',
      message: 'request',
      service: 'cashight',
      route: 'dashboard',
      status: 200,
    });
  });

  it('drops sensitive fields', () => {
    const read = capture();
    logger.warn('upload', {
      jobId: 'job-1',
      token: 'secret-token',
      email: 'someone@example.com',
      description: 'GRAB*RIDE',
      transactions: [{ amountVnd: 1 }],
    });
    const line = read();
    expect(line.jobId).toBe('job-1');
    expect(line).not.toHaveProperty('token');
    expect(line).not.toHaveProperty('email');
    expect(line).not.toHaveProperty('description');
    expect(line).not.toHaveProperty('transactions');
  });

  it('does not let fields override level or message', () => {
    const read = capture();
    logger.error('boom', { level: 'info', message: 'spoofed' });
    expect(read()).toMatchObject({ level: 'error', message: 'boom' });
  });

  it('ends each line with a newline', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    logger.info('x');
    expect(String(write.mock.calls[0][0]).endsWith('\n')).toBe(true);
  });
});
