import type { AwsInvoiceDashboard } from '@cashight/domain/aws-invoices';
import {
  BadgeDollarSign,
  Boxes,
  Building2,
  CircleDollarSign,
  ReceiptText,
  ShieldMinus,
} from 'lucide-react';

import { Card } from '@/components/ui/card';
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
      icon: BadgeDollarSign,
    },
    {
      label: 'Service charges',
      value: formatInvoiceMoney(dashboard.kpis.serviceCharges, currency),
      helper: 'Before credits and tax',
      icon: CircleDollarSign,
    },
    {
      label: 'Credits',
      value: formatInvoiceMoney(dashboard.kpis.credits, currency),
      helper: 'Subtracted from charges',
      icon: ShieldMinus,
    },
    {
      label: 'Tax',
      value: formatInvoiceMoney(dashboard.kpis.tax, currency),
      helper: 'Tax on this invoice',
      icon: ReceiptText,
    },
    {
      label: 'Linked accounts',
      value: String(dashboard.kpis.linkedAccountCount),
      helper: 'Masked allocations',
      icon: Building2,
    },
    {
      label: 'Billed services',
      value: String(dashboard.kpis.billedServiceCount),
      helper: 'Non-zero services',
      icon: Boxes,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ label, value, helper, icon: Icon }) => (
        <Card key={label} className="gap-0 p-5 md:p-6">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
            <Icon className="size-5" aria-hidden />
          </div>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white/90">
            {value}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {helper}
          </p>
        </Card>
      ))}
    </div>
  );
}
