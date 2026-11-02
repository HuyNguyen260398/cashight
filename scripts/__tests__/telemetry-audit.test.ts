import { describe, expect, it } from 'vitest';

import { findDisallowedAttributes, findSensitiveValues } from '../local/telemetry-audit';

type Attr = { key: string; value: { stringValue: string } };

function attrs(entries: Record<string, string>): Attr[] {
  return Object.entries(entries).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

const cashightResource = {
  attributes: attrs({
    'service.name': 'cashight-api',
    'service.namespace': 'cashight',
    'service.version': 'abc123',
    'k8s.pod.name': 'cashight-api-0',
  }),
};

function spans(spanAttributes: Record<string, string>, resource = cashightResource): string {
  return JSON.stringify({
    resourceSpans: [{ resource, scopeSpans: [{ spans: [{ attributes: attrs(spanAttributes) }] }] }],
  });
}

function sumMetric(pointAttributes: Record<string, string>, resource: object = cashightResource): string {
  return JSON.stringify({
    resourceMetrics: [
      {
        resource,
        scopeMetrics: [
          {
            metrics: [
              { name: 'cashight.worker.jobs', sum: { dataPoints: [{ attributes: attrs(pointAttributes) }] } },
            ],
          },
        ],
      },
    ],
  });
}

function logRecord(body: string, recordAttributes: Record<string, string> = {}): string {
  return JSON.stringify({
    resourceLogs: [
      {
        resource: cashightResource,
        scopeLogs: [{ logRecords: [{ body: { stringValue: body }, attributes: attrs(recordAttributes) }] }],
      },
    ],
  });
}

describe('findDisallowedAttributes', () => {
  it('accepts the attributes Cashight emits', () => {
    const lines = [
      spans({
        'http.request.method': 'GET',
        'http.route': 'dashboard',
        'http.response.status_code': '200',
        'cashight.worker.outcome': 'succeeded',
      }),
      sumMetric({ outcome: 'failed' }),
      logRecord('{"message":"ok"}', { 'log.iostream': 'stdout' }),
    ];
    expect(findDisallowedAttributes(lines)).toEqual([]);
  });

  it('reports a span attribute outside the allowlist', () => {
    expect(findDisallowedAttributes([spans({ 'url.full': 'https://x/y?token=1' })])).toEqual([
      'span:url.full',
    ]);
  });

  it('reports a resource attribute outside the allowlist', () => {
    const resource = { attributes: [...cashightResource.attributes, ...attrs({ 'host.name': 'laptop' })] };
    expect(findDisallowedAttributes([spans({}, resource)])).toEqual(['resource:host.name']);
  });

  it('ignores data-point attributes of infra metrics', () => {
    const infra = { attributes: attrs({ 'k8s.node.name': 'ip-10-0-0-1' }) };
    expect(findDisallowedAttributes([sumMetric({ state: 'used' }, infra)])).toEqual([]);
  });

  it('reports a log attribute outside the allowlist', () => {
    expect(findDisallowedAttributes([logRecord('x', { 'log.file.path': '/var/log/pods/a/b/0.log' })])).toEqual([
      'log:log.file.path',
    ]);
  });
});

describe('findSensitiveValues', () => {
  it('finds an email, a PAN-length digit run and a bearer token in values and bodies', () => {
    const lines = [
      logRecord('{"message":"x","user":"a@b.co"}'),
      spans({ 'http.route': '4111111111111111' }),
      logRecord('authorization: bearer abc'),
    ];
    expect(findSensitiveValues(lines)).toEqual(['log:bearer', 'log:email', 'span:digits']);
  });

  it('finds nothing sensitive in a trace id', () => {
    const lines = [
      logRecord('{"message":"x","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736"}'),
      logRecord('{"message":"x","trace_id":"12345678901234567890123456789012"}'),
    ];
    expect(findSensitiveValues(lines)).toEqual([]);
  });

  // A span id is 16 hex characters; about 1 in 1,800 is all decimal digits.
  it('finds nothing sensitive in an all-digit span id', () => {
    const lines = [logRecord('{"message":"x","span_id":"3736364742388658"}')];
    expect(findSensitiveValues(lines)).toEqual([]);
  });

  it('still finds a PAN beside a span id', () => {
    const lines = [logRecord('{"span_id":"3736364742388658","description":"4111111111111111"}')];
    expect(findSensitiveValues(lines)).toEqual(['log:digits']);
  });
});
