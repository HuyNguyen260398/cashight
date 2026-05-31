import type { AggregatedView } from '@/lib/aggregations';
import { formatVND } from '@/lib/format';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';

export function KpiCards({ view }: { view: AggregatedView }) {
  const { totals, statementCount, byCategory } = view;
  const software =
    byCategory.find((c) => c.category === 'Software & Subscriptions')?.value ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {/* 1. Total spend across the period — new card purchases. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Spend
          </CardTitle>
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
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Installments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.totalInstallments)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Billed this period</p>
        </CardContent>
      </Card>

      {/* 3. Fees & interest. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Fees &amp; Interest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.totalFeesAndInterest)}
          </p>
        </CardContent>
      </Card>

      {/* 4. Cashback received (positive magnitude). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Cashback
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.totalCashback)}
          </p>
        </CardContent>
      </Card>

      {/* 5. How many statements rolled up into this view (a count, not money). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Statements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{statementCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">in this period</p>
        </CardContent>
      </Card>

      {/* 6. Software & Subscriptions spend for the period. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Software &amp; Subscriptions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{formatVND(software)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Subscriptions this period</p>
        </CardContent>
      </Card>
    </div>
  );
}
