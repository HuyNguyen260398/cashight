import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { periodLabel, type PeriodSpec } from '@/lib/period';

export function EmptyPeriodState({ spec }: { spec: PeriodSpec }) {
  return (
    <div className="text-center py-16">
      <h2 className="text-xl mb-2">No statements for {periodLabel(spec)}</h2>
      <p className="text-muted-foreground mb-6">
        There&apos;s no spending data for this period. Upload a statement, or
        jump back to your most recent data.
      </p>
      <div className="flex items-center justify-center gap-3">
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
