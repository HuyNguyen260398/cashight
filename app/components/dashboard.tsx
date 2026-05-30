import type { Statement } from '@/lib/schemas';
import {
  byCategory,
  topMerchants,
  cumulativeByDay,
} from '@/lib/dashboard-aggregations';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { KpiCards } from '@/app/components/kpi-cards';
import { TransactionsTable } from '@/app/components/transactions-table';
import { CategoryPie } from '@/app/components/category-pie';
import { MerchantBar } from '@/app/components/merchant-bar';
import { DailySpendLine } from '@/app/components/daily-spend-line';

export function Dashboard({ statement }: { statement: Statement }) {
  return (
    <div className="space-y-6">
      {/* Row 1: KPI cards */}
      <KpiCards statement={statement} />

      {/* Row 2: Category pie + Top merchants bar */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryPie data={byCategory(statement)} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Top merchants</CardTitle>
          </CardHeader>
          <CardContent>
            <MerchantBar data={topMerchants(statement, 10)} />
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Cumulative spend area chart */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Cumulative spend</CardTitle>
        </CardHeader>
        <CardContent>
          <DailySpendLine data={cumulativeByDay(statement)} />
        </CardContent>
      </Card>

      {/* Row 4: Transactions table */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionsTable transactions={statement.transactions} />
        </CardContent>
      </Card>
    </div>
  );
}
