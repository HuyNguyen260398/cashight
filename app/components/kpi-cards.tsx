import type { Statement } from '@/lib/schemas';
import { totalSpend } from '@/lib/dashboard-aggregations';
import { formatVND } from '@/lib/format';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';

const NON_SPEND_CATEGORIES = new Set([
  'Installments',
  'Cashback',
  'Fees & Interest',
  'Payment',
]);

export function KpiCards({ statement }: { statement: Statement }) {
  const spend = totalSpend(statement);

  // Biggest spend transaction: category NOT in NON_SPEND_CATEGORIES, amountVnd > 0
  const biggestTx = statement.transactions
    .filter(
      (t) => !NON_SPEND_CATEGORIES.has(t.category) && t.amountVnd > 0,
    )
    .reduce<(typeof statement.transactions)[number] | null>((max, t) => {
      if (max === null || t.amountVnd > max.amountVnd) return t;
      return max;
    }, null);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {/* 1. Total spent */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Spent
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{formatVND(spend)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            + {formatVND(statement.totals.totalInstallments)} in installments
          </p>
        </CardContent>
      </Card>

      {/* 2. Fees & interest */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Fees &amp; Interest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(statement.totals.totalFeesAndInterest)}
          </p>
        </CardContent>
      </Card>

      {/* 3. Cashback received */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Cashback Received
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(statement.totals.totalCashback)}
          </p>
        </CardContent>
      </Card>

      {/* 4. Biggest transaction */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Biggest Transaction
          </CardTitle>
        </CardHeader>
        <CardContent>
          {biggestTx ? (
            <>
              <p className="text-2xl font-semibold">
                {formatVND(biggestTx.amountVnd)}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {biggestTx.description}
              </p>
            </>
          ) : (
            <p className="text-2xl font-semibold">—</p>
          )}
        </CardContent>
      </Card>

      {/* 5. Minimum payment due */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Minimum Payment Due
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {formatVND(statement.totals.minimumPayment)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
