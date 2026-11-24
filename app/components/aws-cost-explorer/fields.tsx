'use client';

import type { ReactNode } from 'react';
import DatePicker from '@cloudscape-design/components/date-picker';
import FormField from '@cloudscape-design/components/form-field';
import Select from '@cloudscape-design/components/select';

export interface FieldOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * Cloudscape Select inside a FormField. `data-testid` is the label so tests
 * (and e2e) can find the control the way they found the old native select.
 */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  onFocus,
  description,
  footer,
  hideLabel = false,
  disabled = false,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<FieldOption<T>>;
  onChange: (value: T) => void;
  onFocus?: () => void;
  description?: string;
  footer?: ReactNode;
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.value === value) ?? { value, label: value };
  return (
    <FormField label={hideLabel ? undefined : label} description={description} secondaryControl={footer}>
      <Select
        data-testid={label}
        ariaLabel={label}
        selectedOption={{ value: selected.value, label: selected.label }}
        options={options.map((option) => ({ value: option.value, label: option.label, disabled: option.disabled }))}
        onChange={({ detail }) => onChange(detail.selectedOption.value as T)}
        onFocus={onFocus}
        disabled={disabled}
      />
    </FormField>
  );
}

/** Cloudscape DatePicker (ISO `YYYY-MM-DD` values) inside a FormField. */
export function DateField({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
}) {
  return (
    <FormField label={label} description={description}>
      <DatePicker
        data-testid={label}
        ariaLabel={label}
        value={value}
        placeholder="YYYY/MM/DD"
        openCalendarAriaLabel={(selected) => `Choose ${label.toLowerCase()}${selected ? `, selected ${selected}` : ''}`}
        onChange={({ detail }) => onChange(detail.value)}
      />
    </FormField>
  );
}
