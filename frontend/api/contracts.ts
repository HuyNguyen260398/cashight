import { z } from 'zod';
import {
  UploadJobSchema,
  UploadJobStateSchema,
  CreateUploadRequestSchema,
} from '@cashight/domain/api';

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
// AggregatedView from @cashight/domain is a complex nested type with no Zod
// schema, so we accept unknown and cast at the call site.
export const DashboardResponseSchema = z.unknown();

// ── Standard error envelope ──────────────────────────────────────────────────

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
