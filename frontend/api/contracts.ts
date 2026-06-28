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

// ── Standard error envelope ──────────────────────────────────────────────────

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
