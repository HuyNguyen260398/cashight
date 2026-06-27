import { z } from 'zod';

export const UploadJobStateSchema = z.enum([
  'PENDING_UPLOAD',
  'PROCESSING',
  'CONFLICT',
  'SUCCEEDED',
  'FAILED',
]);
export type UploadJobState = z.infer<typeof UploadJobStateSchema>;

export const CreateUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.literal('application/pdf'),
  size: z.number().int().positive().max(5 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  force: z.boolean().default(false),
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

export const UploadJobSchema = z.object({
  jobId: z.string().uuid(),
  state: UploadJobStateSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  errorCode: z.string().optional(),
  statementId: z.string().optional(),
  conflict: z
    .object({
      cardLast4: z.string().regex(/^\d{4}$/),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
    })
    .optional(),
});
export type UploadJob = z.infer<typeof UploadJobSchema>;
