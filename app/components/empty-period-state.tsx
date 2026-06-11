import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { periodLabel, type PeriodSpec } from '@/lib/period';
import { CalendarX } from 'lucide-react';

export function EmptyPeriodState({ spec }: { spec: PeriodSpec }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
        <CalendarX className="size-7" aria-hidden />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white/90">
        No statements for {periodLabel(spec)}
      </h2>
      <p className="mx-auto mb-6 max-w-lg text-sm text-gray-500 dark:text-gray-400">
        There&apos;s no spending data for this period. Upload a statement, or
        jump back to your most recent data.
      </p>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/upload">Upload statement</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Go to latest</Link>
        </Button>
      </div>
    </div>
  );
}
