import type { AggregatedView } from '@/lib/aggregations';
import { formatVND } from '@/lib/format';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import {
  Wallet,            // Total Spend
  CalendarClock,     // Installments
  MonitorSmartphone, // Software & Subscriptions
  Percent,           // Fees & Interest
  PiggyBank,         // Cashback
  FileText,          // Statements
} from 'lucide-react';

export function KpiCards({ view }: { view: AggregatedView }) {
  const { totals, statementCount, byCategory } = view;
  const software =
    byCategory.find((c) => c.category === 'Software & Subscriptions')?.value ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {/* 1. Total spend across the period — new card purchases. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Spend
          </CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.totalSpend)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            New card purchases
          </p>
        </CardContent>
      </Card>

      {/* 2. Installments billed this period (tracked separately from spend). */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Installments
          </CardTitle>
          <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.totalInstallments)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Billed this period</p>
        </CardContent>
      </Card>

      {/* 3. Software & Subscriptions spend for the period. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Software &amp; Subscriptions
          </CardTitle>
          <MonitorSmartphone className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{formatVND(software)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Subscriptions this period</p>
        </CardContent>
      </Card>

      {/* 4. Fees & interest. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Fees &amp; Interest
          </CardTitle>
          <Percent className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.totalFeesAndInterest)}
          </p>
        </CardContent>
      </Card>

      {/* 5. Cashback received (positive magnitude). */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Cashback
          </CardTitle>
          <PiggyBank className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.totalCashback)}
          </p>
        </CardContent>
      </Card>

      {/* 6. How many statements rolled up into this view (a count, not money). */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Statements
          </CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{statementCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">in this period</p>
        </CardContent>
      </Card>
    </div>
  );
}
