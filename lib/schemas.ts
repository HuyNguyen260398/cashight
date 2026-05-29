import { z } from 'zod';

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
