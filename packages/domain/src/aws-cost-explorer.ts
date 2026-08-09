import { z } from 'zod';

const MAX_FILTER_DEPTH = 5;
const MAX_FILTER_NODES = 100;
const MAX_FILTER_VALUES = 1_024;

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Expected a valid YYYY-MM-DD date');

const TimePeriodSchema = z
  .object({
    start: IsoDateSchema,
    end: IsoDateSchema,
  })
  .strict()
  .refine(({ start, end }) => start < end, {
    message: 'Start date must be before the exclusive end date',
    path: ['end'],
  });

const DimensionExpressionLeafSchema = z
  .object({
    Key: z.string().min(1).max(128),
    Values: z.array(z.string().max(256)).max(MAX_FILTER_VALUES),
    MatchOptions: z
      .array(z.enum(['EQUALS', 'CASE_SENSITIVE']))
      .max(2)
      .optional(),
  })
  .strict();

const AttributeExpressionLeafSchema = z
  .object({
    Key: z.string().min(1).max(128),
    Values: z.array(z.string().max(256)).max(MAX_FILTER_VALUES),
    MatchOptions: z
      .array(z.enum(['EQUALS', 'ABSENT', 'CASE_SENSITIVE']))
      .max(3)
      .optional(),
  })
  .strict();

export type CostExplorerExpression =
  | { And: CostExplorerExpression[] }
  | { Or: CostExplorerExpression[] }
  | { Not: CostExplorerExpression }
  | { Dimensions: z.infer<typeof DimensionExpressionLeafSchema> }
  | { Tags: z.infer<typeof AttributeExpressionLeafSchema> }
  | { CostCategories: z.infer<typeof AttributeExpressionLeafSchema> };

export const CostExplorerExpressionSchema: z.ZodType<CostExplorerExpression> =
  z.lazy(() =>
    z.union([
      z
        .object({ And: z.array(CostExplorerExpressionSchema).min(1).max(100) })
        .strict(),
      z
        .object({ Or: z.array(CostExplorerExpressionSchema).min(1).max(100) })
        .strict(),
      z.object({ Not: CostExplorerExpressionSchema }).strict(),
      z.object({ Dimensions: DimensionExpressionLeafSchema }).strict(),
      z.object({ Tags: AttributeExpressionLeafSchema }).strict(),
      z.object({ CostCategories: AttributeExpressionLeafSchema }).strict(),
    ]),
  );

function expressionStats(
  expression: CostExplorerExpression,
  depth = 1,
): { depth: number; nodes: number; values: number } {
  if ('Not' in expression) {
    const child = expressionStats(expression.Not, depth + 1);
    return { ...child, nodes: child.nodes + 1 };
  }

  if ('And' in expression || 'Or' in expression) {
    const children = 'And' in expression ? expression.And : expression.Or;
    return children.reduce(
      (total, childExpression) => {
        const child = expressionStats(childExpression, depth + 1);
        return {
          depth: Math.max(total.depth, child.depth),
          nodes: total.nodes + child.nodes,
          values: total.values + child.values,
        };
      },
      { depth, nodes: 1, values: 0 },
    );
  }

  const leaf =
    'Dimensions' in expression
      ? expression.Dimensions
      : 'Tags' in expression
        ? expression.Tags
        : expression.CostCategories;
  return { depth, nodes: 1, values: leaf.Values.length };
}

function containsResourceId(expression: CostExplorerExpression): boolean {
  if ('Dimensions' in expression) return expression.Dimensions.Key === 'RESOURCE_ID';
  if ('Not' in expression) return containsResourceId(expression.Not);
  if ('And' in expression || 'Or' in expression) {
    const children = 'And' in expression ? expression.And : expression.Or;
    return children.some(containsResourceId);
  }
  return false;
}

const GroupDefinitionSchema = z
  .object({
    type: z.enum(['DIMENSION', 'TAG', 'COST_CATEGORY']),
    key: z.string().min(1).max(128),
  })
  .strict();

export const CostExplorerReportRequestSchema = z
  .object({
    mode: z.enum(['STANDARD', 'RESOURCE', 'COMPARISON']),
    billingViewArn: z.string().min(1).max(2_048).optional(),
    timePeriod: TimePeriodSchema,
    comparisonTimePeriod: TimePeriodSchema.optional(),
    granularity: z.enum(['MONTHLY', 'DAILY', 'HOURLY']),
    metric: z.enum([
      'UnblendedCost',
      'BlendedCost',
      'AmortizedCost',
      'NetUnblendedCost',
      'NetAmortizedCost',
      'UsageQuantity',
      'NormalizedUsageAmount',
    ]),
    groupBy: z.array(GroupDefinitionSchema).max(2),
    filter: CostExplorerExpressionSchema.optional(),
    chartStyle: z.enum(['BAR', 'STACK', 'LINE']),
    showForecast: z.boolean(),
    showOnlyUntagged: z.boolean(),
    showOnlyUncategorized: z.boolean(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.filter) {
      const stats = expressionStats(request.filter);
      if (stats.depth > MAX_FILTER_DEPTH) {
        context.addIssue({
          code: 'custom',
          path: ['filter'],
          message: `Filter depth must not exceed ${MAX_FILTER_DEPTH}`,
        });
      }
      if (stats.nodes > MAX_FILTER_NODES) {
        context.addIssue({
          code: 'custom',
          path: ['filter'],
          message: `Filter expression count must not exceed ${MAX_FILTER_NODES}`,
        });
      }
      if (stats.values > MAX_FILTER_VALUES) {
        context.addIssue({
          code: 'custom',
          path: ['filter'],
          message: `Selected filter values must not exceed ${MAX_FILTER_VALUES}`,
        });
      }
    }

    const groupsByResource = request.groupBy.some(
      (group) => group.type === 'DIMENSION' && group.key === 'RESOURCE_ID',
    );
    const filtersByResource = request.filter
      ? containsResourceId(request.filter)
      : false;

    if (request.mode === 'RESOURCE' && !groupsByResource && !filtersByResource) {
      context.addIssue({
        code: 'custom',
        path: ['groupBy'],
        message: 'Resource reports must group or filter by RESOURCE_ID',
      });
    }

    if (request.mode === 'COMPARISON') {
      if (!request.comparisonTimePeriod) {
        context.addIssue({
          code: 'custom',
          path: ['comparisonTimePeriod'],
          message: 'Comparison reports require a comparison time period',
        });
      }
      if (request.granularity === 'HOURLY') {
        context.addIssue({
          code: 'custom',
          path: ['granularity'],
          message: 'Comparison reports do not support hourly granularity',
        });
      }
      if (groupsByResource || filtersByResource) {
        context.addIssue({
          code: 'custom',
          path: ['groupBy'],
          message: 'Comparison reports do not support resource data',
        });
      }
    } else if (request.comparisonTimePeriod) {
      context.addIssue({
        code: 'custom',
        path: ['comparisonTimePeriod'],
        message: 'Only comparison reports accept a comparison time period',
      });
    }
  });
export type CostExplorerReportRequest = z.infer<
  typeof CostExplorerReportRequestSchema
>;

export const CostExplorerErrorCodeSchema = z.enum([
  'COGNITO_REAUTH_REQUIRED',
  'INVALID_COST_QUERY',
  'GRANULARITY_NOT_AVAILABLE',
  'COST_EXPLORER_DISABLED',
  'AWS_COST_ACCESS_DENIED',
  'AWS_COST_QUERY_BUSY',
  'AWS_COST_THROTTLED',
]);
export type CostExplorerErrorCode = z.infer<typeof CostExplorerErrorCodeSchema>;

const DecimalStringSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);

function isBreakdownCursor(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const decoded = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    return (
      decoded !== null &&
      typeof decoded === 'object' &&
      Object.keys(decoded).length === 3 &&
      decoded.version === 1 &&
      typeof decoded.digest === 'string' &&
      /^[a-f0-9]{64}$/.test(decoded.digest) &&
      Number.isInteger(decoded.offset) &&
      decoded.offset >= 0
    );
  } catch {
    return false;
  }
}

export const CostExplorerResultSchema = z
  .object({
    source: z.enum(['AWS', 'CACHE']),
    asOf: z.string().datetime(),
    currencyOrUnit: z.string().min(1).max(32),
    estimated: z.boolean(),
    overview: z
      .object({
        total: DecimalStringSchema,
        average: DecimalStringSchema,
        currentMonthToDate: DecimalStringSchema.optional(),
        forecastTotal: DecimalStringSchema.optional(),
        previousTotal: DecimalStringSchema.optional(),
        absoluteChange: DecimalStringSchema.optional(),
        percentageChange: DecimalStringSchema.optional(),
      })
      .strict(),
    periods: z.array(
      z
        .object({
          start: IsoDateSchema,
          end: IsoDateSchema,
          estimated: z.boolean(),
        })
        .strict(),
    ),
    series: z
      .array(
        z
          .object({
            key: z.string().min(1).max(512),
            label: z.string().min(1).max(512),
            values: z.array(DecimalStringSchema),
            total: DecimalStringSchema,
          })
          .strict(),
      )
      .max(10),
    breakdown: z
      .array(
        z
          .object({
            groupValues: z.array(z.string().max(512)).max(2),
            values: z.array(DecimalStringSchema),
            total: DecimalStringSchema,
            estimated: z.boolean(),
            comparisonValues: z.array(DecimalStringSchema).optional(),
            absoluteChange: DecimalStringSchema.optional(),
            percentageChange: DecimalStringSchema.optional(),
          })
          .strict(),
      )
      .max(50),
    comparisonDrivers: z.array(
      z
        .object({
          name: z.string().min(1).max(512),
          absoluteChange: DecimalStringSchema,
          percentageChange: DecimalStringSchema.optional(),
        })
        .strict(),
    ),
    nextBreakdownCursor: z
      .string()
      .max(4_096)
      .refine(isBreakdownCursor, 'Invalid breakdown cursor')
      .optional(),
  })
  .strict();
export type CostExplorerResult = z.infer<typeof CostExplorerResultSchema>;

export const SavedCostReportSchema = z
  .object({
    reportId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    request: CostExplorerReportRequestSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type SavedCostReport = z.infer<typeof SavedCostReportSchema>;

export const CostDimensionRequestSchema = z
  .object({
    type: z.enum(['DIMENSION', 'TAG', 'COST_CATEGORY']),
    key: z.string().min(1).max(128),
    timePeriod: TimePeriodSchema,
    billingViewArn: z.string().min(1).max(2_048).optional(),
    search: z.string().trim().max(256).optional(),
    cursor: z.string().max(4_096).optional(),
  })
  .strict();
export type CostDimensionRequest = z.infer<typeof CostDimensionRequestSchema>;
