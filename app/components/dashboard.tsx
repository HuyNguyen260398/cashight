import type { AggregatedView } from '@/lib/aggregations';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AiSummaryCard } from '@/app/components/ai-summary-card';
import { KpiCards } from '@/app/components/kpi-cards';
import { TransactionsTable } from '@/app/components/transactions-table';
import { CategoryPie } from '@/app/components/category-pie';
import { MerchantBar } from '@/app/components/merchant-bar';
import { TrendChart } from '@/app/components/trend-chart';
import { InstallmentAreaChart } from '@/app/components/installment-area-chart';
import { RevealPanel } from '@/app/components/reveal-panel';

export function Dashboard({ view }: { view: AggregatedView }) {
  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      <RevealPanel delayIndex={0} className="col-span-12 xl:col-span-7 xl:h-[636px]">
        <KpiCards view={view} />
      </RevealPanel>

      <RevealPanel delayIndex={1} className="col-span-12 xl:col-span-5 xl:h-[636px]">
        <AiSummaryCard view={view} />
      </RevealPanel>

      <RevealPanel delayIndex={2} className="col-span-12">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="border-b border-gray-100 dark:border-gray-800">
            <CardTitle>Spending trend</CardTitle>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              New card purchases across the selected period.
            </p>
          </CardHeader>
          <CardContent className="pt-5">
            <TrendChart view={view} />
          </CardContent>
        </Card>
      </RevealPanel>

      <RevealPanel delayIndex={3} className="col-span-12">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="border-b border-gray-100 dark:border-gray-800">
            <CardTitle>Total installments</CardTitle>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Installment billings separated from new purchases.
            </p>
          </CardHeader>
          <CardContent className="pt-5">
            <InstallmentAreaChart view={view} />
          </CardContent>
        </Card>
      </RevealPanel>

      <RevealPanel delayIndex={4} className="col-span-12 h-full xl:col-span-6">
        <Card className="h-full min-w-0 overflow-hidden">
          <CardHeader className="border-b border-gray-100 dark:border-gray-800">
            <CardTitle>Spending by category</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <CategoryPie data={view.byCategory} />
          </CardContent>
        </Card>
      </RevealPanel>

      <RevealPanel delayIndex={5} className="col-span-12 h-full xl:col-span-6">
        <Card className="h-full min-w-0 overflow-hidden">
          <CardHeader className="border-b border-gray-100 dark:border-gray-800">
            <CardTitle>Top merchants</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <MerchantBar data={view.topMerchants} />
          </CardContent>
        </Card>
      </RevealPanel>

      <RevealPanel delayIndex={6} className="col-span-12">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="border-b border-gray-100 dark:border-gray-800">
            <CardTitle>Transactions</CardTitle>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Recent statement lines for the selected period.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <TransactionsTable transactions={view.transactions} />
          </CardContent>
        </Card>
      </RevealPanel>
    </div>
  );
}
