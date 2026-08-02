'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { bankShortName, type BankCode } from '@/lib/banks';

/** Sentinel for "no filter" — Radix Select cannot hold an empty string value. */
const ALL = 'all';

export function BankSelector({
  current,
  available,
}: {
  current: BankCode | null;
  available: BankCode[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setBank(value: string) {
    // Preserve the period params — only the bank changes.
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL) {
      params.delete('bank');
    } else {
      params.set('bank', value);
    }
    router.push(`/?${params}`);
  }

  return (
    <Select value={current ?? ALL} onValueChange={setBank}>
      <SelectTrigger aria-label="Filter by bank" className="min-w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All banks</SelectItem>
        {available.map((code) => (
          <SelectItem key={code} value={code}>
            {bankShortName(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
