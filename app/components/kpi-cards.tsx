import type { AggregatedView } from '@/lib/aggregations';
import { formatDate, formatVND } from '@/lib/format';
import { Card } from '@/components/ui/card';
import {
  Wallet,            // Total Spend
  Landmark,          // Statement Balance
  CalendarClock,     // Installments
  MonitorSmartphone, // Software & Subscriptions
  Percent,           // Fees & Interest
  PiggyBank,         // Cashback
} from 'lucide-react';

export function KpiCards({ view }: { view: AggregatedView }) {
  const { totals, byCategory, latestStatement } = view;
  const software =
    byCategory.find((c) => c.category === 'Software & Subscriptions')?.value ?? 0;

  const cards = [
    {
      title: 'Total Spend',
      value: formatVND(totals.totalSpend),
      helper: 'New card purchases',
      icon: Wallet,
    },
    {
      // Second in the list so it shares the first row with Total Spend once
      // the grid goes two-wide. A balance is a snapshot, not a sum, so for
      // multi-statement periods this is the latest statement's balance — the
      // helper text says which one.
      title: 'Statement Balance',
      value: latestStatement ? formatVND(latestStatement.statementBalance) : '—',
      helper: latestStatement
        ? `As of ${formatDate(latestStatement.statementDate)}`
        : 'No statement in this period',
      icon: Landmark,
    },
    {
      title: 'Installments',
      value: formatVND(totals.totalInstallments),
      helper: 'Billed this period',
      icon: CalendarClock,
    },
    {
      title: 'Software & Subscriptions',
      value: formatVND(software),
      helper: 'Subscriptions this period',
      icon: MonitorSmartphone,
    },
    {
      title: 'Fees & Interest',
      value: formatVND(totals.totalFeesAndInterest),
      helper: 'Charges and interest',
      icon: Percent,
    },
    {
      title: 'Cashback',
      value: formatVND(totals.totalCashback),
      helper: 'Credits received',
      icon: PiggyBank,
    },
  ];

  return (
    <div className="grid h-full grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 xl:grid-rows-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title} className="gap-0 p-5 md:p-6">
            <div className="flex size-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
              <Icon className="size-6 text-gray-800 dark:text-white/90" aria-hidden />
            </div>
            <div className="mt-5 flex min-w-0 items-end justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {card.title}
                </span>
                <p className="mt-2 truncate text-2xl font-bold tabular-nums text-gray-900 dark:text-white/90">
                  {card.value}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {card.helper}
                </p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
