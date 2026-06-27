import { z } from 'zod';
import type { AggregatedView } from './aggregations';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const TransactionSchema = z.object({
  date: IsoDate,
  postingDate: IsoDate,
  description: z.string().min(1),
  currency: z.enum(['VND', 'USD', 'HKD', 'EUR', 'GBP', 'JPY', 'SGD', 'AUD', 'CAD']),
  originalAmount: z.number().nonnegative(),
  amountVnd: z.number(),
  category: z.string().min(1),
  isInstallment: z.boolean(),
  isInternational: z.boolean(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const StatementTotalsSchema = z.object({
  previousBalance: z.number(),
  statementBalance: z.number(),
  minimumPayment: z.number(),
  totalSpend: z.number(),
  totalInstallments: z.number(),
  totalCashback: z.number(),
  totalFeesAndInterest: z.number(),
});
export type StatementTotals = z.infer<typeof StatementTotalsSchema>;

export const StatementSchema = z.object({
  bank: z.literal('TPBank'),
  cardLast4: z.string().regex(/^\d{4}$/, 'cardLast4 must be exactly 4 digits'),
  statementDate: IsoDate,
  paymentDueDate: IsoDate,
  creditLimit: z.number().nonnegative(),
  totals: StatementTotalsSchema,
  transactions: z.array(TransactionSchema),
});
export type Statement = z.infer<typeof StatementSchema>;

/**
 * Boundary schema for an AggregatedView (aggregations.ts).
 *
 * Used to validate the POST body of /api/summarize ("Zod at the boundary").
 * Kept field-for-field with the AggregatedView interface so a parsed value is
 * assignable to that type — the route casts the validated data accordingly.
 */
const PeriodSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('month'), year: z.number(), month: z.number() }),
  z.object({ type: z.literal('quarter'), year: z.number(), quarter: z.number() }),
  z.object({ type: z.literal('year'), year: z.number() }),
]);

export const AggregatedViewSchema = z.object({
  spec: PeriodSpecSchema,
  label: z.string(),
  statementCount: z.number(),
  totals: z.object({
    totalSpend: z.number(),
    totalInstallments: z.number(),
    totalCashback: z.number(),
    totalFeesAndInterest: z.number(),
  }),
  transactions: z.array(TransactionSchema),
  byCategory: z.array(
    z.object({
      category: z.string(),
      value: z.number(),
      pct: z.number(),
    }),
  ),
  topMerchants: z.array(
    z.object({
      merchant: z.string(),
      value: z.number(),
    }),
  ),
  subPeriods: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
  installmentSubPeriods: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
}) satisfies z.ZodType<AggregatedView>;
