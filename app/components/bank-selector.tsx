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

/**
 * The banks to offer, current one first and never duplicated.
 *
 * `current` is always included, even when the period holds no statement for it:
 * Radix renders a blank trigger when the value has no matching item, and the
 * selection has to stay switchable to get back out of an empty view.
 *
 * Exported for testing — the options live in a portal that only exists while
 * the select is open, so this logic is verified directly rather than by
 * driving the dropdown.
 */
export function bankOptions(
  current: BankCode,
  available: BankCode[],
): BankCode[] {
  return [current, ...available.filter((code) => code !== current)];
}

export function BankSelector({
  current,
  available,
}: {
  current: BankCode;
  available: BankCode[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const options = bankOptions(current, available);

  function setBank(value: string) {
    // Preserve the period params — only the bank changes.
    const params = new URLSearchParams(searchParams.toString());
    params.set('bank', value);
    router.push(`/?${params}`);
  }

  return (
    <Select value={current} onValueChange={setBank}>
      <SelectTrigger aria-label="Filter by bank" className="min-w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((code) => (
          <SelectItem key={code} value={code}>
            {bankShortName(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
