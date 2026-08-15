import {
  CostExplorerReportRequestSchema,
  type CostExplorerExpression,
  type CostExplorerReportRequest,
} from '@cashight/domain/aws-cost-explorer';

const FILTER_VERSION_PREFIX = 'v1.';
const MAX_FILTER_JSON_BYTES = 64 * 1_024;

const SINGLE_VALUE_PARAMETERS = [
  'mode',
  'billingView',
  'start',
  'end',
  'compareStart',
  'compareEnd',
  'granularity',
  'metric',
  'chart',
  'forecast',
  'untagged',
  'uncategorized',
  'filter',
] as const;

const KNOWN_PARAMETERS = new Set<string>([
  ...SINGLE_VALUE_PARAMETERS,
  'group',
]);

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createDefaultCostReportRequest(
  now = new Date(),
): CostExplorerReportRequest {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 6, 1),
  );
  return {
    mode: 'STANDARD',
    timePeriod: { start: isoDate(start), end: isoDate(end) },
    granularity: 'MONTHLY',
    metric: 'UnblendedCost',
    groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
    chartStyle: 'STACK',
    showForecast: false,
    showOnlyUntagged: false,
    showOnlyUncategorized: false,
  };
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > MAX_FILTER_JSON_BYTES) {
    throw new RangeError('Cost report filter exceeds the URL size limit.');
  }

  let binary = '';
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string | undefined {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const estimatedBytes = Math.floor((value.length * 3) / 4);
  if (estimatedBytes > MAX_FILTER_JSON_BYTES) return undefined;

  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard.padEnd(
      standard.length + ((4 - (standard.length % 4)) % 4),
      '=',
    );
    const binary = atob(padded);
    if (binary.length > MAX_FILTER_JSON_BYTES) return undefined;
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function parseFilter(value: string): CostExplorerExpression | undefined {
  if (!value.startsWith(FILTER_VERSION_PREFIX)) return undefined;
  const decoded = base64UrlDecode(value.slice(FILTER_VERSION_PREFIX.length));
  if (decoded === undefined) return undefined;
  try {
    return JSON.parse(decoded) as CostExplorerExpression;
  } catch {
    return undefined;
  }
}

function parseBoolean(value: string | null, fallback: boolean): boolean | null {
  if (value === null) return fallback;
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

function parseGroups(
  values: string[],
  fallback: CostExplorerReportRequest['groupBy'],
): CostExplorerReportRequest['groupBy'] | undefined {
  if (values.length === 0) return fallback;
  if (values.length === 1 && values[0] === 'none') return [];
  if (values.includes('none')) return undefined;

  return values.map((value) => {
    const separator = value.indexOf(':');
    if (separator <= 0 || separator === value.length - 1) {
      return { type: '', key: '' };
    }
    return {
      type: value.slice(0, separator),
      key: value.slice(separator + 1),
    };
  }) as CostExplorerReportRequest['groupBy'];
}

function toSearchParams(search: URLSearchParams | string): URLSearchParams {
  if (search instanceof URLSearchParams) return search;
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

export function parseCostReportSearch(
  search: URLSearchParams | string,
  defaults: CostExplorerReportRequest = createDefaultCostReportRequest(),
): CostExplorerReportRequest {
  const fallback = CostExplorerReportRequestSchema.parse(defaults);
  const params = toSearchParams(search);
  const hasKnownState = [...params.keys()].some((key) =>
    KNOWN_PARAMETERS.has(key),
  );
  if (!hasKnownState) return fallback;
  if (
    SINGLE_VALUE_PARAMETERS.some((key) => params.getAll(key).length > 1)
  ) {
    return fallback;
  }

  const showForecast = parseBoolean(
    params.get('forecast'),
    fallback.showForecast,
  );
  const showOnlyUntagged = parseBoolean(
    params.get('untagged'),
    fallback.showOnlyUntagged,
  );
  const showOnlyUncategorized = parseBoolean(
    params.get('uncategorized'),
    fallback.showOnlyUncategorized,
  );
  const groupBy = parseGroups(params.getAll('group'), fallback.groupBy);
  if (
    showForecast === null ||
    showOnlyUntagged === null ||
    showOnlyUncategorized === null ||
    groupBy === undefined
  ) {
    return fallback;
  }

  const rawFilter = params.get('filter');
  const filter = rawFilter === null ? fallback.filter : parseFilter(rawFilter);
  if (rawFilter !== null && filter === undefined) return fallback;

  const mode = params.get('mode') ?? fallback.mode;
  const compareStart = params.get('compareStart');
  const compareEnd = params.get('compareEnd');
  if ((compareStart === null) !== (compareEnd === null)) return fallback;

  const candidate = {
    mode,
    ...(params.get('billingView') || fallback.billingViewArn
      ? { billingViewArn: params.get('billingView') ?? fallback.billingViewArn }
      : {}),
    timePeriod: {
      start: params.get('start') ?? fallback.timePeriod.start,
      end: params.get('end') ?? fallback.timePeriod.end,
    },
    ...(compareStart !== null && compareEnd !== null
      ? { comparisonTimePeriod: { start: compareStart, end: compareEnd } }
      : mode === 'COMPARISON' && fallback.comparisonTimePeriod
        ? { comparisonTimePeriod: fallback.comparisonTimePeriod }
        : {}),
    granularity: params.get('granularity') ?? fallback.granularity,
    metric: params.get('metric') ?? fallback.metric,
    groupBy,
    ...(filter ? { filter } : {}),
    chartStyle: params.get('chart') ?? fallback.chartStyle,
    showForecast,
    showOnlyUntagged,
    showOnlyUncategorized,
  };
  const parsed = CostExplorerReportRequestSchema.safeParse(candidate);
  return parsed.success ? parsed.data : fallback;
}

export function serializeCostReportSearch(
  rawReport: CostExplorerReportRequest,
): URLSearchParams {
  const report = CostExplorerReportRequestSchema.parse(rawReport);
  const params = new URLSearchParams();
  params.set('mode', report.mode);
  if (report.billingViewArn) params.set('billingView', report.billingViewArn);
  params.set('start', report.timePeriod.start);
  params.set('end', report.timePeriod.end);
  if (report.comparisonTimePeriod) {
    params.set('compareStart', report.comparisonTimePeriod.start);
    params.set('compareEnd', report.comparisonTimePeriod.end);
  }
  params.set('granularity', report.granularity);
  params.set('metric', report.metric);
  if (report.groupBy.length === 0) {
    params.append('group', 'none');
  } else {
    for (const group of report.groupBy) {
      params.append('group', `${group.type}:${group.key}`);
    }
  }
  params.set('chart', report.chartStyle);
  if (report.showForecast) params.set('forecast', '1');
  if (report.showOnlyUntagged) params.set('untagged', '1');
  if (report.showOnlyUncategorized) params.set('uncategorized', '1');
  if (report.filter) {
    params.set(
      'filter',
      `${FILTER_VERSION_PREFIX}${base64UrlEncode(JSON.stringify(report.filter))}`,
    );
  }
  return params;
}
