import type { ReactNode } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function InvoiceChartCard({
  title,
  description,
  ariaLabel,
  summary,
  empty,
  children,
}: {
  title: string;
  description: string;
  ariaLabel: string;
  summary: ReactNode;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-gray-200 px-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            No {title.toLowerCase()} data
          </div>
        ) : (
          <div role="img" aria-label={ariaLabel} className="aws-invoice-chart min-w-0">
            <div className="sr-only">{summary}</div>
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
