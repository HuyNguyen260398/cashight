import { z } from 'zod';
import {
  UploadJobSchema,
  UploadJobStateSchema,
  CreateUploadRequestSchema,
} from '@cashight/domain/api';
import { BANK_CODES } from '@cashight/domain/banks';
import { SessionCapabilitiesSchema } from '@cashight/domain/workspace';
import {
  CostExplorerReportRequestSchema,
  CostExplorerResultSchema,
  SavedCostReportSchema,
} from '@cashight/domain/aws-cost-explorer';
import {
  AwsInvoiceDashboardSchema,
  AwsInvoiceMetadataSchema,
  AwsInvoiceSchema,
  AwsInvoiceUploadJobSchema,
  YearMonthSchema,
} from '@cashight/domain/aws-invoices';

// Re-export domain primitives for consumers of this module.
export { UploadJobSchema, UploadJobStateSchema, CreateUploadRequestSchema };
export type {
  UploadJob,
  UploadJobState,
  CreateUploadRequest,
} from '@cashight/domain/api';

// ── Upload presign ───────────────────────────────────────────────────────────

export const UploadPresignSchema = z.object({
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
});
export type UploadPresign = z.infer<typeof UploadPresignSchema>;

// ── POST /uploads response ───────────────────────────────────────────────────

export const CreateUploadResponseSchema = z.object({
  job: UploadJobSchema,
  upload: UploadPresignSchema,
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;

// ── GET /uploads/:jobId response ─────────────────────────────────────────────

export const UploadJobResponseSchema = z.object({
  job: UploadJobSchema,
});
export type UploadJobResponse = z.infer<typeof UploadJobResponseSchema>;

// ── GET /statements list item ────────────────────────────────────────────────

export const StatementListItemSchema = z.object({
  statementId: z.string(),
  cardLast4: z.string().regex(/^\d{4}$/),
  // Older API responses omit this; every pre-VIB statement is a TPBank one.
  bank: z.enum(BANK_CODES).default('TPBank'),
  statementDate: z.string(), // "YYYY-MM-DD"
  totalSpend: z.number(),
  transactionCount: z.number().int(),
  uploadedAt: z.string(),
});
export type StatementListItem = z.infer<typeof StatementListItemSchema>;

// ── GET /statements response ─────────────────────────────────────────────────

export const StatementsListResponseSchema = z.object({
  items: z.array(StatementListItemSchema),
  nextCursor: z.string().nullable(),
});
export type StatementsListResponse = z.infer<typeof StatementsListResponseSchema>;

// ── GET /dashboard response ──────────────────────────────────────────────────
// Structural minimum: validates the key envelope fields while letting the full
// AggregatedView shape pass through via .passthrough(). The call site casts to
// AggregatedView after parse succeeds.
export const DashboardResponseSchema = z.object({
  spec: z.object({ type: z.string(), year: z.number() }).passthrough(),
  statementCount: z.number(),
  label: z.string(),
}).passthrough();
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

// ── AWS Billing Invoice responses ───────────────────────────────────────────

export {
  AwsInvoiceDashboardSchema,
  AwsInvoiceSchema,
  AwsInvoiceUploadJobSchema,
  YearMonthSchema,
};
export type {
  AwsInvoice,
  AwsInvoiceDashboard,
  AwsInvoiceUploadJob,
  YearMonth,
} from '@cashight/domain/aws-invoices';

export const AwsInvoiceUploadPresignSchema = UploadPresignSchema.strict();

export const CreateAwsInvoiceUploadResponseSchema = z
  .object({
    job: AwsInvoiceUploadJobSchema,
    upload: AwsInvoiceUploadPresignSchema,
  })
  .strict();

export const AwsInvoiceUploadJobResponseSchema = z
  .object({ job: AwsInvoiceUploadJobSchema })
  .strict();

export const AwsInvoiceListItemSchema = AwsInvoiceMetadataSchema.pick({
  yearMonth: true,
  currency: true,
  amountDue: true,
  tax: true,
  serviceCount: true,
  linkedAccountCount: true,
  uploadedAt: true,
}).strict();
export type AwsInvoiceListItem = z.infer<typeof AwsInvoiceListItemSchema>;

export const AwsInvoiceListResponseSchema = z
  .object({
    items: z.array(AwsInvoiceListItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const AwsInvoiceDetailResponseSchema = z
  .object({ invoice: AwsInvoiceSchema })
  .strict();

export const AwsInvoiceDashboardResponseSchema = z
  .object({ dashboard: AwsInvoiceDashboardSchema })
  .strict();

export const DeleteAwsInvoiceResponseSchema = z
  .object({
    yearMonth: YearMonthSchema,
    deleted: z.literal(true),
  })
  .strict();

// ── GET /session/capabilities response ───────────────────────────────────────

export { SessionCapabilitiesSchema };
export type { SessionCapabilities } from '@cashight/domain/workspace';

// ── AWS Cost Explorer responses ──────────────────────────────────────────────

const DecimalStringSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CostExplorerCompleteResultSchema = CostExplorerResultSchema.extend({
  breakdown: z.array(CostExplorerResultSchema.shape.breakdown.element),
  pageCount: z.number().int().positive(),
}).strict();
export type CostExplorerCompleteResult = z.infer<
  typeof CostExplorerCompleteResultSchema
>;

export const CostExplorerQueryResponseSchema = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    result: CostExplorerCompleteResultSchema,
    refreshCooldownUntil: z.string().datetime().optional(),
  })
  .strict();
export type CostExplorerQueryResponse = z.infer<
  typeof CostExplorerQueryResponseSchema
>;

export const CostExplorerForecastSchema = z
  .object({
    total: DecimalStringSchema,
    unit: z.string().min(1).max(32),
    periods: z.array(
      z
        .object({
          start: IsoDateSchema,
          end: IsoDateSchema,
          mean: DecimalStringSchema,
          lowerBound: DecimalStringSchema.optional(),
          upperBound: DecimalStringSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type CostExplorerForecast = z.infer<typeof CostExplorerForecastSchema>;

const CostComparisonMetricSchema = z
  .object({
    baseline: DecimalStringSchema,
    comparison: DecimalStringSchema,
    difference: DecimalStringSchema,
    unit: z.string().min(1).max(32),
  })
  .strict();

const CostComparisonRowSchema = z
  .object({
    groupValues: z.array(z.string().max(512)).max(2),
    metrics: z.record(z.string(), CostComparisonMetricSchema),
  })
  .strict();

export const CostExplorerComparisonSchema = z
  .object({
    comparisons: z.array(CostComparisonRowSchema),
    total: z.record(z.string(), CostComparisonMetricSchema),
    drivers: z.array(
      CostComparisonRowSchema.extend({
        type: z.string().max(128).optional(),
        name: z.string().max(512).optional(),
      }).strict(),
    ),
    pageCount: z.number().int().positive(),
  })
  .strict();
export type CostExplorerComparison = z.infer<
  typeof CostExplorerComparisonSchema
>;

export const CostExplorerForecastResponseSchema = z
  .object({ forecast: CostExplorerForecastSchema })
  .strict();

export const CostExplorerComparisonResponseSchema = z
  .object({ comparison: CostExplorerComparisonSchema })
  .strict();

export const SavedCostReportsResponseSchema = z
  .object({ items: z.array(SavedCostReportSchema) })
  .strict();

export const SavedCostReportResponseSchema = z
  .object({ report: SavedCostReportSchema })
  .strict();

export const DeleteSavedCostReportResponseSchema = z
  .object({
    reportId: z.string().uuid(),
    deleted: z.literal(true),
  })
  .strict();

export const CostCsvExportResponseSchema = z
  .object({
    downloadUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    fileName: z.string().min(1).max(255),
  })
  .strict();
export type CostCsvExportResponse = z.infer<typeof CostCsvExportResponseSchema>;

export const CostDimensionValueSchema = z
  .object({
    value: z.string(),
    attributes: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const CostDimensionValuesResponseSchema = z
  .object({
    items: z.array(CostDimensionValueSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const CostBillingViewsResponseSchema = z
  .object({
    billingViews: z.array(
      z
        .object({
          arn: z.string().min(1).max(2_048),
          name: z.string().min(1).max(512),
          description: z.string().max(2_048).optional(),
          type: z.string().max(128).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const PutSavedCostReportRequestSchema = z
  .object({
    reportId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    request: CostExplorerReportRequestSchema,
  })
  .strict();

// ── Standard error envelope ──────────────────────────────────────────────────

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    retryable: z.boolean().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
