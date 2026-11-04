/**
 * Audit what the local OpenTelemetry Collector exported (its `file/local`
 * exporter, OTLP JSON, one object per line) for two privacy failures:
 *
 * - an attribute key outside the collector's allowlist, and
 * - an attribute value or log body that looks like an email, a card-number
 *   length digit run, or a bearer token.
 *
 * Usage: pnpm tsx scripts/local/telemetry-audit.ts <collected.jsonl>
 * Prints each finding and exits 1 if there are any. See docs/observability.md.
 *
 * Never deployed. Nothing here is imported by the app or the Lambda bundles.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Mirrors `transform/allowlist` in aws-eks-infra
 * gitops/platform/config/addons/opentelemetry-collector.yaml. Keep in step.
 * Data-point keys are checked for Cashight's own metrics only, as the
 * collector allowlists them.
 */
export const ALLOWED_ATTRIBUTES = {
  resource: /^(service|k8s)\./,
  span: ['http.request.method', 'http.route', 'http.response.status_code', 'cashight.worker.outcome'],
  spanevent: [] as string[],
  datapoint: ['http.request.method', 'http.route', 'http.response.status_code', 'outcome', 'error_code'],
  log: ['log.iostream'],
} as const;

const SENSITIVE_PATTERNS: Array<[name: string, pattern: RegExp]> = [
  ['email', /[^\s"@]+@[^\s"@]+\.[^\s"@]+/],
  ['digits', /\b\d{13,19}\b/],
  ['bearer', /\bbearer\s/i],
];

// Trace and span ids are random hex; a 16-character span id is all decimal
// digits about once in 1,800 spans and would read as a PAN. Removed before
// matching, so a PAN elsewhere in the same body is still found.
const TRACE_IDS = /"(?:trace_id|span_id)":"[0-9a-f]+"/g;

interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  /** Base64 in OTLP JSON. */
  bytesValue?: string;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
}
interface KeyValue {
  key: string;
  value?: AnyValue;
}
interface Resource {
  attributes?: KeyValue[];
}
interface DataPoints {
  dataPoints?: Array<{ attributes?: KeyValue[] }>;
}
interface Metric {
  sum?: DataPoints;
  gauge?: DataPoints;
  histogram?: DataPoints;
  exponentialHistogram?: DataPoints;
  summary?: DataPoints;
}
interface ExportLine {
  resourceSpans?: Array<{
    resource?: Resource;
    scopeSpans?: Array<{ spans?: Array<{ attributes?: KeyValue[]; events?: Array<{ attributes?: KeyValue[] }> }> }>;
  }>;
  resourceMetrics?: Array<{ resource?: Resource; scopeMetrics?: Array<{ metrics?: Metric[] }> }>;
  resourceLogs?: Array<{
    resource?: Resource;
    scopeLogs?: Array<{ logRecords?: Array<{ attributes?: KeyValue[]; body?: AnyValue }> }>;
  }>;
}

type Level = 'resource' | 'span' | 'spanevent' | 'datapoint' | 'log';

interface Visit {
  level: Level;
  attributes: KeyValue[];
  /** Data points of a non-Cashight resource are not allowlisted. */
  checkKeys: boolean;
  body?: AnyValue;
}

// Keys whose values are random ids, skipped inside structured log bodies for
// the same reason TRACE_IDS strips them from string bodies.
const ID_KEYS = new Set(['trace_id', 'span_id', 'traceId', 'spanId']);

/**
 * Every scalar in an AnyValue as text, descending into arrays and key-value
 * lists. The collector's json_parser turns a log line into a kvlistValue
 * body, so reading only stringValue would skip the whole line.
 */
export function scalarStrings(value: AnyValue | undefined): string[] {
  if (!value) return [];
  if (value.stringValue !== undefined) return [value.stringValue.replace(TRACE_IDS, '')];
  if (value.intValue !== undefined) return [String(value.intValue)];
  if (value.doubleValue !== undefined) return [String(value.doubleValue)];
  if (value.boolValue !== undefined) return [String(value.boolValue)];
  if (value.bytesValue !== undefined) return [Buffer.from(value.bytesValue, 'base64').toString('utf8')];
  if (value.arrayValue) return (value.arrayValue.values ?? []).flatMap(scalarStrings);
  if (value.kvlistValue) {
    return (value.kvlistValue.values ?? []).flatMap((kv) => (ID_KEYS.has(kv.key) ? [] : scalarStrings(kv.value)));
  }
  return [];
}

function isCashight(resource: Resource | undefined): boolean {
  return (resource?.attributes ?? []).some(
    (a) => a.key === 'service.namespace' && a.value?.stringValue === 'cashight',
  );
}

function* visit(line: ExportLine): Generator<Visit> {
  for (const rs of line.resourceSpans ?? []) {
    yield { level: 'resource', attributes: rs.resource?.attributes ?? [], checkKeys: true };
    for (const scope of rs.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        yield { level: 'span', attributes: span.attributes ?? [], checkKeys: true };
        for (const event of span.events ?? []) {
          yield { level: 'spanevent', attributes: event.attributes ?? [], checkKeys: true };
        }
      }
    }
  }
  for (const rm of line.resourceMetrics ?? []) {
    yield { level: 'resource', attributes: rm.resource?.attributes ?? [], checkKeys: true };
    const own = isCashight(rm.resource);
    for (const scope of rm.scopeMetrics ?? []) {
      for (const metric of scope.metrics ?? []) {
        const data =
          metric.sum ?? metric.gauge ?? metric.histogram ?? metric.exponentialHistogram ?? metric.summary;
        for (const point of data?.dataPoints ?? []) {
          yield { level: 'datapoint', attributes: point.attributes ?? [], checkKeys: own };
        }
      }
    }
  }
  for (const rl of line.resourceLogs ?? []) {
    yield { level: 'resource', attributes: rl.resource?.attributes ?? [], checkKeys: true };
    for (const scope of rl.scopeLogs ?? []) {
      for (const record of scope.logRecords ?? []) {
        yield {
          level: 'log',
          attributes: record.attributes ?? [],
          checkKeys: true,
          body: record.body,
        };
      }
    }
  }
}

function allowed(level: Level, key: string): boolean {
  if (level === 'resource') return ALLOWED_ATTRIBUTES.resource.test(key);
  return (ALLOWED_ATTRIBUTES[level] as readonly string[]).includes(key);
}

function parse(lines: string[]): ExportLine[] {
  return lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as ExportLine);
}

/** Sorted unique `<level>:<key>` for every attribute key outside the allowlist. */
export function findDisallowedAttributes(lines: string[]): string[] {
  const found = new Set<string>();
  for (const line of parse(lines)) {
    for (const v of visit(line)) {
      if (!v.checkKeys) continue;
      for (const a of v.attributes) {
        if (!allowed(v.level, a.key)) found.add(`${v.level}:${a.key}`);
      }
    }
  }
  return [...found].sort();
}

/** Sorted unique `<level>:<pattern>` for values or log bodies that look sensitive. */
export function findSensitiveValues(lines: string[]): string[] {
  const found = new Set<string>();
  for (const line of parse(lines)) {
    for (const v of visit(line)) {
      const values = v.attributes.flatMap((a) => scalarStrings(a.value));
      values.push(...scalarStrings(v.body));
      for (const value of values) {
        for (const [name, pattern] of SENSITIVE_PATTERNS) {
          if (pattern.test(value)) found.add(`${v.level}:${name}`);
        }
      }
    }
  }
  return [...found].sort();
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: pnpm tsx scripts/local/telemetry-audit.ts <collected.jsonl>');
    process.exit(2);
  }
  const lines = (await readFile(file, 'utf8')).split('\n');
  const findings = [
    ...findDisallowedAttributes(lines).map((f) => `disallowed attribute ${f}`),
    ...findSensitiveValues(lines).map((f) => `sensitive value ${f}`),
  ];
  for (const finding of findings) console.log(finding);
  console.log(`${lines.filter((l) => l.trim()).length} export lines, ${findings.length} findings`);
  process.exit(findings.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
