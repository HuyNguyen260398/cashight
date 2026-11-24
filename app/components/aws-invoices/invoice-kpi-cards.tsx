import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';

import { formatInvoiceMoney } from './invoice-format';

export function InvoiceKpiCards({
  dashboard,
}: {
  dashboard: AwsInvoiceDashboard;
}) {
  const { currency } = dashboard.selected;
  const cards = [
    {
      label: 'Amount due',
      value: formatInvoiceMoney(dashboard.kpis.amountDue, currency),
      helper: 'Net billed amount',
    },
    {
      label: 'Service charges',
      value: formatInvoiceMoney(dashboard.kpis.serviceCharges, currency),
      helper: 'Before credits and tax',
    },
    {
      label: 'Credits',
      value: formatInvoiceMoney(dashboard.kpis.credits, currency),
      helper: 'Subtracted from charges',
    },
    {
      label: 'Tax',
      value: formatInvoiceMoney(dashboard.kpis.tax, currency),
      helper: 'Tax on this invoice',
    },
    {
      label: 'Linked accounts',
      value: String(dashboard.kpis.linkedAccountCount),
      helper: 'Masked allocations',
    },
    {
      label: 'Billed services',
      value: String(dashboard.kpis.billedServiceCount),
      helper: 'Non-zero services',
    },
  ];

  return (
    <Container header={<Header variant="h2">Invoice summary</Header>}>
      <ColumnLayout columns={3} variant="text-grid" minColumnWidth={160}>
        {cards.map(({ label, value, helper }) => (
          <div key={label}>
            <Box variant="awsui-key-label">{label}</Box>
            <Box variant="awsui-value-large">{value}</Box>
            <Box variant="small" display="block" color="text-body-secondary">
              {helper}
            </Box>
          </div>
        ))}
      </ColumnLayout>
    </Container>
  );
}
