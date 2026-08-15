import {
  CostExplorerReportRequestSchema,
  type CostExplorerExpression,
  type CostExplorerReportRequest,
} from './aws-cost-explorer';

const RESOURCE_SERVICE = 'Amazon Elastic Compute Cloud - Compute';
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface CostExplorerPreferences {
  granularDataEnabled: boolean;
  currentDate?: string;
}

export type CostExplorerValidationIssueCode =
  | 'GRANULARITY_NOT_AVAILABLE'
  | 'INVALID_COST_QUERY'
  | 'USAGE_UNIT_MAY_BE_MIXED'
  | 'NORMALIZED_USAGE_SCOPE_RECOMMENDED';

export interface CostExplorerValidationIssue {
  path: string;
  code: CostExplorerValidationIssueCode;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface CostExplorerValidationResult {
  valid: boolean;
  issues: CostExplorerValidationIssue[];
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableObject(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, child]) => [key, stableObject(child)]),
  );
}

function canonicalExpression(expression: CostExplorerExpression): JsonValue {
  if ('And' in expression || 'Or' in expression) {
    const operator = 'And' in expression ? 'And' : 'Or';
    const expressions = 'And' in expression ? expression.And : expression.Or;
    const children = expressions
      .map(canonicalExpression)
      .sort((left, right) =>
        compareStrings(
          JSON.stringify(stableObject(left)),
          JSON.stringify(stableObject(right)),
        ),
      );
    return { [operator]: children };
  }

  if ('Not' in expression) return { Not: canonicalExpression(expression.Not) };

  const operator = 'Dimensions' in expression
    ? 'Dimensions'
    : 'Tags' in expression
      ? 'Tags'
      : 'CostCategories';
  const leaf = 'Dimensions' in expression
    ? expression.Dimensions
    : 'Tags' in expression
      ? expression.Tags
      : expression.CostCategories;
  return {
    [operator]: {
      Key: leaf.Key,
      Values: [...leaf.Values].sort(compareStrings),
      ...(leaf.MatchOptions
        ? {
            MatchOptions: [...leaf.MatchOptions].sort(compareStrings),
          }
        : {}),
    },
  };
}

export function canonicalizeCostExplorerRequest(
  request: CostExplorerReportRequest,
): string {
  const parsed = CostExplorerReportRequestSchema.parse(request);
  const normalized = {
    ...parsed,
    ...(parsed.filter ? { filter: canonicalExpression(parsed.filter) } : {}),
  } as JsonValue;
  return JSON.stringify(stableObject(normalized));
}

export async function costExplorerQueryDigest(
  request: CostExplorerReportRequest,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeCostExplorerRequest(request));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function utcEpochDay(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / MILLISECONDS_PER_DAY;
}

function hasDimension(
  expression: CostExplorerExpression | undefined,
  key: string,
  requiredValue?: string,
  negated = false,
): boolean {
  if (!expression) return false;
  if ('Dimensions' in expression) {
    return (
      !negated &&
      expression.Dimensions.Key === key &&
      (requiredValue === undefined ||
        expression.Dimensions.Values.includes(requiredValue))
    );
  }
  if ('Not' in expression) {
    return hasDimension(expression.Not, key, requiredValue, !negated);
  }
  if ('And' in expression || 'Or' in expression) {
    const children = 'And' in expression ? expression.And : expression.Or;
    return children.some((child) =>
      hasDimension(child, key, requiredValue, negated),
    );
  }
  return false;
}

function error(
  path: string,
  code: Extract<
    CostExplorerValidationIssueCode,
    'GRANULARITY_NOT_AVAILABLE' | 'INVALID_COST_QUERY'
  >,
  message: string,
): CostExplorerValidationIssue {
  return { path, code, severity: 'ERROR', message };
}

function warning(
  code: Extract<
    CostExplorerValidationIssueCode,
    'USAGE_UNIT_MAY_BE_MIXED' | 'NORMALIZED_USAGE_SCOPE_RECOMMENDED'
  >,
  message: string,
): CostExplorerValidationIssue {
  return { path: 'metric', code, severity: 'WARNING', message };
}

export function validateCostExplorerSemantics(
  request: CostExplorerReportRequest,
  preferences: CostExplorerPreferences,
): CostExplorerValidationResult {
  const parsed = CostExplorerReportRequestSchema.safeParse(request);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue): CostExplorerValidationIssue =>
        error(issue.path.join('.') || 'request', 'INVALID_COST_QUERY', issue.message),
    );
    return { valid: false, issues };
  }

  const report = parsed.data;
  const issues: CostExplorerValidationIssue[] = [];
  const resourceReport = report.mode === 'RESOURCE';

  if (report.granularity === 'HOURLY' && !resourceReport) {
    issues.push(
      error(
        'granularity',
        'GRANULARITY_NOT_AVAILABLE',
        'Hourly granularity is available only for eligible resource reports.',
      ),
    );
  }

  if ((resourceReport || report.granularity === 'HOURLY') && !preferences.granularDataEnabled) {
    issues.push(
      error(
        resourceReport ? 'mode' : 'granularity',
        'GRANULARITY_NOT_AVAILABLE',
        'Granular Cost Explorer data is disabled by the deployment operator.',
      ),
    );
  }

  if (resourceReport) {
    const rangeDays =
      utcEpochDay(report.timePeriod.end) - utcEpochDay(report.timePeriod.start);
    const currentDate =
      preferences.currentDate ?? new Date().toISOString().slice(0, 10);
    const earliestStart = utcEpochDay(currentDate) - 14;
    if (rangeDays > 14 || utcEpochDay(report.timePeriod.start) < earliestStart) {
      issues.push(
        error(
          'timePeriod',
          'INVALID_COST_QUERY',
          'Resource reports must stay within the most recent 14 days.',
        ),
      );
    }
    if (!hasDimension(report.filter, 'SERVICE', RESOURCE_SERVICE)) {
      issues.push(
        error(
          'filter',
          'INVALID_COST_QUERY',
          `Resource reports require SERVICE = ${RESOURCE_SERVICE}.`,
        ),
      );
    }
  }

  if (report.showForecast && report.groupBy.length > 0) {
    issues.push(
      error(
        'showForecast',
        'INVALID_COST_QUERY',
        'Forecast values are unavailable for grouped reports.',
      ),
    );
  }

  if (report.showForecast && report.mode !== 'STANDARD') {
    issues.push(
      error(
        'showForecast',
        'INVALID_COST_QUERY',
        'Forecast values are available only for standard reports.',
      ),
    );
  }

  if (report.metric === 'UsageQuantity' &&
    !hasDimension(report.filter, 'USAGE_TYPE') &&
    !hasDimension(report.filter, 'USAGE_TYPE_GROUP')) {
    issues.push(
      warning(
        'USAGE_UNIT_MAY_BE_MIXED',
        'UsageQuantity may combine incompatible units unless usage type is constrained.',
      ),
    );
  }

  if (
    report.metric === 'NormalizedUsageAmount' &&
    !hasDimension(report.filter, 'SERVICE', RESOURCE_SERVICE)
  ) {
    issues.push(
      warning(
        'NORMALIZED_USAGE_SCOPE_RECOMMENDED',
        'NormalizedUsageAmount is meaningful only for supported normalized usage.',
      ),
    );
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'ERROR'),
    issues,
  };
}
