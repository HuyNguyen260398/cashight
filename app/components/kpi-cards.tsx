import type { Statement } from '@/lib/schemas';
import { totalSpend } from '@/lib/dashboard-aggregations';
import { formatVND } from '@/lib/format';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';

export function KpiCards({ statement }: { statement: Statement }) {
  const spend = totalSpend(statement);
  const { totals } = statement;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {/* 1. Statement balance — the total owed on this statement (headline). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Statement Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.statementBalance)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Total owed (Dư nợ sao kê)
          </p>
        </CardContent>
      </Card>

      {/* 2. Spend this month — the statement's "Your Spend for this Month". */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Spent this month
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{formatVND(spend)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            New card purchases
          </p>
        </CardContent>
      </Card>

      {/* 3. Installments billed this period (tracked separately from spend). */}
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

      {/* 4. Fees & interest. */}
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

      {/* 5. Cashback received (positive magnitude). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Cashback Received
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.totalCashback)}
          </p>
        </CardContent>
      </Card>

      {/* 6. Minimum payment due. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Minimum Payment Due
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(totals.minimumPayment)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
