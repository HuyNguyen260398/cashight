import type { AggregatedView } from '@/lib/aggregations';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { KpiCards } from '@/app/components/kpi-cards';
import { TransactionsTable } from '@/app/components/transactions-table';
import { CategoryPie } from '@/app/components/category-pie';
import { MerchantBar } from '@/app/components/merchant-bar';
import { TrendChart } from '@/app/components/trend-chart';

export function Dashboard({ view }: { view: AggregatedView }) {
  return (
    <div className="space-y-6">
      {/* Row 1: KPI cards */}
      <KpiCards view={view} />

      {/* Row 2: Spending trend across sub-periods (the headline multi-period chart) */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Spending trend</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart view={view} />
        </CardContent>
      </Card>

      {/* Row 3: Category pie + Top merchants bar */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryPie data={view.byCategory} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Top merchants</CardTitle>
          </CardHeader>
          <CardContent>
            <MerchantBar data={view.topMerchants} />
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Transactions table */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionsTable transactions={view.transactions} />
        </CardContent>
      </Card>
    </div>
  );
}
