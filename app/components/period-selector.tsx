'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import SpaceBetween from '@cloudscape-design/components/space-between';
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
  const searchParams = useSearchParams();

  function setPeriod(spec: PeriodSpec) {
    // Start from the current URL so the bank filter survives a period change —
    // rebuilding from scratch silently reset it on every next/prev click.
    // month/quarter are rewritten below, so stale ones must be cleared.
    const params = new URLSearchParams(searchParams.toString());
    params.delete('month');
    params.delete('quarter');
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
        // A year/quarter spec carries no specific month, so fall back to the
        // current calendar month. Round-trips like month→quarter→month do not
        // restore the original month — this is intentional.
        return {
          type: 'month',
          year: current.year,
          month: current.type === 'month' ? current.month : new Date().getMonth() + 1,
        };
    }
  }

  return (
    <SpaceBetween direction="horizontal" size="xs" alignItems="center">
      <SegmentedControl
        label="Period type"
        selectedId={current.type}
        options={[
          { id: 'month', text: 'Month' },
          { id: 'quarter', text: 'Quarter' },
          { id: 'year', text: 'Year' },
        ]}
        onChange={({ detail }) => setPeriod(toType(detail.selectedId as PeriodType))}
      />
      <SpaceBetween direction="horizontal" size="xxs" alignItems="center">
        <Button
          variant="icon"
          iconName="angle-left"
          ariaLabel="Previous period"
          onClick={() => setPeriod(previousPeriod(current))}
        />
        <Box fontWeight="bold" textAlign="center" display="inline-block">
          <span style={{ display: 'inline-block', minWidth: 96 }}>{periodLabel(current)}</span>
        </Box>
        <Button
          variant="icon"
          iconName="angle-right"
          ariaLabel="Next period"
          onClick={() => setPeriod(nextPeriod(current))}
        />
      </SpaceBetween>
    </SpaceBetween>
  );
}
