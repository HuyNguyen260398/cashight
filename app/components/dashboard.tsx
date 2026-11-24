import Container from '@cloudscape-design/components/container';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { AggregatedView } from '@/lib/aggregations';
import { AiSummaryCard } from '@/app/components/ai-summary-card';
import { KpiCards } from '@/app/components/kpi-cards';
import { TransactionsTable } from '@/app/components/transactions-table';
import { CategoryPie } from '@/app/components/category-pie';
import { MerchantBar } from '@/app/components/merchant-bar';
import { TrendChart } from '@/app/components/trend-chart';
import { InstallmentAreaChart } from '@/app/components/installment-area-chart';

const HALF = [{ colspan: { default: 12, m: 6 } }, { colspan: { default: 12, m: 6 } }];

export function Dashboard({ view }: { view: AggregatedView }) {
  return (
    <SpaceBetween size="l">
      <Grid gridDefinition={[{ colspan: { default: 12, m: 7 } }, { colspan: { default: 12, m: 5 } }]}>
        <KpiCards view={view} />
        <AiSummaryCard view={view} />
      </Grid>

      <Container
        header={
          <Header variant="h2" description="New card purchases across the selected period.">
            Spending trend
          </Header>
        }
      >
        <TrendChart view={view} />
      </Container>

      <Container
        header={
          <Header variant="h2" description="Installment billings separated from new purchases.">
            Total installments
          </Header>
        }
      >
        <InstallmentAreaChart view={view} />
      </Container>

      <Grid gridDefinition={HALF}>
        <Container fitHeight header={<Header variant="h2">Spending by category</Header>}>
          <CategoryPie data={view.byCategory} />
        </Container>
        <Container fitHeight header={<Header variant="h2">Top merchants</Header>}>
          <MerchantBar data={view.topMerchants} />
        </Container>
      </Grid>

      <TransactionsTable transactions={view.transactions} />
    </SpaceBetween>
  );
}
