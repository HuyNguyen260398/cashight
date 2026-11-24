'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import Select from '@cloudscape-design/components/select';
import { bankShortName, type BankCode } from '@/lib/banks';

/**
 * The banks to offer, current one first and never duplicated.
 *
 * `current` is always included, even when the period holds no statement for it:
 * a select renders a blank trigger when the value has no matching option, and the
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

  const selected = { value: current, label: bankShortName(current) };

  return (
    <div style={{ minWidth: 140 }}>
      <Select
        ariaLabel="Filter by bank"
        selectedOption={selected}
        options={options.map((code) => ({ value: code, label: bankShortName(code) }))}
        onChange={({ detail }) => setBank(detail.selectedOption.value!)}
      />
    </div>
  );
}
