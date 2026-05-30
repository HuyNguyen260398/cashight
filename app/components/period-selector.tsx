'use client';

import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  previousPeriod,
  nextPeriod,
  periodLabel,
  quarterOf,
  type PeriodSpec,
  type PeriodType,
} from '@/lib/period';

export function PeriodSelector({ current }: { current: PeriodSpec }) {
  const router = useRouter();

  function setPeriod(spec: PeriodSpec) {
    const params = new URLSearchParams();
    params.set('period', spec.type);
    params.set('year', String(spec.year));
    if (spec.type === 'month') {
      params.set('month', String(spec.month));
    } else if (spec.type === 'quarter') {
      params.set('quarter', String(spec.quarter));
    }
    router.push(`/?${params}`);
  }

  function toType(newType: PeriodType): PeriodSpec {
    switch (newType) {
      case 'year':
        return { type: 'year', year: current.year };
      case 'quarter':
        return {
          type: 'quarter',
          year: current.year,
          quarter:
            current.type === 'quarter'
              ? current.quarter
              : current.type === 'month'
                ? quarterOf(current.month)
                : quarterOf(new Date().getMonth() + 1),
        };
      case 'month':
        return {
          type: 'month',
          year: current.year,
          month: current.type === 'month' ? current.month : new Date().getMonth() + 1,
        };
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      <Tabs
        value={current.type}
        onValueChange={(t) => setPeriod(toType(t as PeriodType))}
      >
        <TabsList>
          <TabsTrigger value="month">Month</TabsTrigger>
          <TabsTrigger value="quarter">Quarter</TabsTrigger>
          <TabsTrigger value="year">Year</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous period"
          onClick={() => setPeriod(previousPeriod(current))}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-[120px] text-center text-sm font-medium">
          {periodLabel(current)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next period"
          onClick={() => setPeriod(nextPeriod(current))}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
