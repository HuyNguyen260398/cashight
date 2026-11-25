import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import type { AggregatedView } from '@/lib/aggregations';
import { formatDate, formatVND } from '@/lib/format';

export function KpiCards({ view }: { view: AggregatedView }) {
  const { totals, byCategory, latestStatement } = view;
  const software =
    byCategory.find((c) => c.category === 'Software & Subscriptions')?.value ?? 0;

  const cards = [
    { title: 'Total Spend', value: formatVND(totals.totalSpend), helper: 'New card purchases' },
    {
      // A balance is a snapshot, not a sum, so for multi-statement periods this
      // is the latest statement's balance — the helper text says which one.
      title: 'Statement Balance',
      value: latestStatement ? formatVND(latestStatement.statementBalance) : '—',
      helper: latestStatement
        ? `As of ${formatDate(latestStatement.statementDate)}`
        : 'No statement in this period',
    },
    { title: 'Installments', value: formatVND(totals.totalInstallments), helper: 'Billed this period' },
    { title: 'Software & Subscriptions', value: formatVND(software), helper: 'Subscriptions this period' },
    { title: 'Fees & Interest', value: formatVND(totals.totalFeesAndInterest), helper: 'Charges and interest' },
    { title: 'Cashback', value: formatVND(totals.totalCashback), helper: 'Credits received' },
  ];

  return (
    <Container fitHeight header={<Header variant="h2">Overview</Header>}>
      <ColumnLayout columns={2} variant="text-grid" minColumnWidth={180}>
        {cards.map((card) => (
          <div key={card.title}>
            <Box variant="awsui-key-label">{card.title}</Box>
            <Box variant="awsui-value-large">{card.value}</Box>
            <Box variant="small" display="block" color="text-body-secondary">
              {card.helper}
            </Box>
          </div>
        ))}
      </ColumnLayout>
    </Container>
  );
}
