import { z } from 'zod';

const MAX_INVOICE_AMOUNT = 90_071_992_547_409.91;

function isValidIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isSafeInteger(Math.round(value * 100)) &&
    Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
}

export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export type YearMonth = z.infer<typeof YearMonthSchema>;

export const AwsInvoiceIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate, 'Expected a valid YYYY-MM-DD date');

export const AwsInvoiceMoneySchema = z
  .number()
  .finite()
  .nonnegative()
  .max(MAX_INVOICE_AMOUNT)
  .refine(hasAtMostTwoDecimals, 'Expected at most two decimal places');

const SignedAwsInvoiceMoneySchema = z
  .number()
  .finite()
  .min(-MAX_INVOICE_AMOUNT)
  .max(MAX_INVOICE_AMOUNT)
  .refine(hasAtMostTwoDecimals, 'Expected at most two decimal places');

const PercentageSchema = z.number().finite().min(0).max(100);

const AwsInvoiceServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    charges: AwsInvoiceMoneySchema,
    tax: AwsInvoiceMoneySchema,
    total: AwsInvoiceMoneySchema,
  })
  .strict();
export type AwsInvoiceService = z.infer<typeof AwsInvoiceServiceSchema>;

const AwsInvoiceTotalsSchema = z
  .object({
    charges: AwsInvoiceMoneySchema,
    credits: AwsInvoiceMoneySchema,
    tax: AwsInvoiceMoneySchema,
    amountDue: AwsInvoiceMoneySchema,
  })
  .strict();
export type AwsInvoiceTotals = z.infer<typeof AwsInvoiceTotalsSchema>;

const AwsInvoiceLinkedAccountSchema = z
  .object({
    accountLast4: z.string().regex(/^\d{4}$/),
    charges: AwsInvoiceMoneySchema,
    credits: AwsInvoiceMoneySchema,
    tax: AwsInvoiceMoneySchema,
    total: AwsInvoiceMoneySchema,
    services: z.array(AwsInvoiceServiceSchema).min(1).max(1_000),
  })
  .strict();
export type AwsInvoiceLinkedAccount = z.infer<
  typeof AwsInvoiceLinkedAccountSchema
>;

export const AwsInvoiceSchema = z
  .object({
    seller: z.literal('Amazon Web Services, Inc.'),
    billingPeriod: z
      .object({
        start: AwsInvoiceIsoDateSchema,
        end: AwsInvoiceIsoDateSchema,
      })
      .strict()
      .refine(({ start, end }) => start <= end, {
        path: ['end'],
        message: 'Billing period end must not precede start',
      }),
    invoiceDate: AwsInvoiceIsoDateSchema,
    dueDate: AwsInvoiceIsoDateSchema,
    currency: z.literal('USD'),
    totals: AwsInvoiceTotalsSchema,
    services: z.array(AwsInvoiceServiceSchema).min(1).max(1_000),
    linkedAccounts: z.array(AwsInvoiceLinkedAccountSchema).min(1).max(1_000),
    source: z
      .object({
        parserId: z.string().trim().min(1).max(128),
        parserVersion: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        uploadedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();
export type AwsInvoice = z.infer<typeof AwsInvoiceSchema>;

export const AwsInvoiceMetadataSchema = z
  .object({
    yearMonth: YearMonthSchema,
    objectKey: z.string().regex(
      /^users\/primary\/aws-invoices\/\d{4}\/\d{4}-(0[1-9]|1[0-2])\.json$/,
    ),
    currency: z.literal('USD'),
    amountDue: AwsInvoiceMoneySchema,
    tax: AwsInvoiceMoneySchema,
    serviceCount: z.number().int().positive().max(1_000),
    linkedAccountCount: z.number().int().positive().max(1_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    parserId: z.string().trim().min(1).max(128),
    parserVersion: z.number().int().positive(),
    uploadedAt: z.string().datetime(),
  })
  .strict();
export type AwsInvoiceMetadata = z.infer<typeof AwsInvoiceMetadataSchema>;

export const AwsInvoiceErrorCodeSchema = z.enum([
  'UNSUPPORTED_AWS_INVOICE',
  'INVOICE_TOTAL_MISMATCH',
  'INVOICE_CONFLICT',
  'INVALID_PDF',
  'CHECKSUM_MISMATCH',
]);
export type AwsInvoiceErrorCode = z.infer<typeof AwsInvoiceErrorCodeSchema>;

export const AwsInvoiceUploadJobStateSchema = z.enum([
  'PENDING_UPLOAD',
  'PROCESSING',
  'CONFLICT',
  'SUCCEEDED',
  'FAILED',
]);
export type AwsInvoiceUploadJobState = z.infer<
  typeof AwsInvoiceUploadJobStateSchema
>;

export const AwsInvoiceUploadJobSchema = z
  .object({
    jobId: z.string().uuid(),
    documentType: z.literal('AWS_INVOICE'),
    owner: z.object({ workspaceId: z.literal('primary') }).strict(),
    state: AwsInvoiceUploadJobStateSchema,
    force: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.number().int().positive(),
    errorCode: AwsInvoiceErrorCodeSchema.optional(),
    yearMonth: YearMonthSchema.optional(),
    conflict: z
      .object({
        year: z.number().int().min(2000).max(9999),
        month: z.number().int().min(1).max(12),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AwsInvoiceUploadJob = z.infer<typeof AwsInvoiceUploadJobSchema>;

const DashboardPercentageItemSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    value: AwsInvoiceMoneySchema,
    percentage: PercentageSchema,
  })
  .strict();

export const AwsInvoiceDashboardSchema = z
  .object({
    selected: AwsInvoiceSchema,
    yearMonth: YearMonthSchema,
    kpis: z
      .object({
        amountDue: AwsInvoiceMoneySchema,
        serviceCharges: AwsInvoiceMoneySchema,
        credits: AwsInvoiceMoneySchema,
        tax: AwsInvoiceMoneySchema,
        linkedAccountCount: z.number().int().nonnegative(),
        billedServiceCount: z.number().int().nonnegative(),
      })
      .strict(),
    serviceBreakdown: z.array(DashboardPercentageItemSchema).max(1_000),
    topServices: z.array(DashboardPercentageItemSchema).max(10),
    chargeComposition: z
      .array(
        z
          .object({
            name: z.enum(['Charges', 'Credits', 'Tax']),
            value: AwsInvoiceMoneySchema,
          })
          .strict(),
      )
      .length(3),
    accountAllocations: z.array(
      z
        .object({
          accountLast4: z.string().regex(/^\d{4}$/),
          value: AwsInvoiceMoneySchema,
          percentage: PercentageSchema,
        })
        .strict(),
    ),
    monthlyTrend: z.array(
      z
        .object({
          yearMonth: YearMonthSchema,
          value: AwsInvoiceMoneySchema,
        })
        .strict(),
    ),
    serviceDetails: z.array(AwsInvoiceServiceSchema).max(1_000),
  })
  .strict();
export type AwsInvoiceDashboard = z.infer<typeof AwsInvoiceDashboardSchema>;

export const AwsInvoiceSummaryPayloadSchema = z
  .object({
    yearMonth: YearMonthSchema,
    currency: z.literal('USD'),
    totals: AwsInvoiceTotalsSchema,
    monthOverMonth: z
      .object({
        amount: SignedAwsInvoiceMoneySchema,
        percentage: z.number().finite(),
      })
      .strict()
      .optional(),
    topServices: z.array(
      z
        .object({
          name: z.string().trim().min(1).max(256),
          amount: AwsInvoiceMoneySchema,
          percentage: PercentageSchema,
        })
        .strict(),
    ).max(5),
    accountAllocations: z.array(
      z.object({ percentage: PercentageSchema }).strict(),
    ),
    taxRatio: PercentageSchema,
  })
  .strict();
export type AwsInvoiceSummaryPayload = z.infer<
  typeof AwsInvoiceSummaryPayloadSchema
>;
