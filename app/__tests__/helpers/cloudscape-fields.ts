import { act } from '@testing-library/react';
import createWrapper from '@cloudscape-design/components/test-utils/dom';

/**
 * Drives the SelectField / DateField controls (aws-cost-explorer/fields.tsx),
 * which carry their label as `data-testid`.
 */
function selectWrapper(label: string) {
  const select = createWrapper(document.body).findSelect(`[data-testid="${label}"]`);
  if (!select) throw new Error(`No select labelled "${label}"`);
  return select;
}

export function hasSelect(label: string): boolean {
  return createWrapper(document.body).findSelect(`[data-testid="${label}"]`) !== null;
}

export function chooseOption(label: string, value: string): void {
  const select = selectWrapper(label);
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue(value));
}

/** Option labels, with `(disabled)` appended to disabled ones. */
export function optionLabels(label: string): string[] {
  const select = selectWrapper(label);
  act(() => select.openDropdown());
  const options = select.findDropdown().findOptions().map((option) =>
    `${option.findLabel().getElement().textContent}${option.isDisabled() ? ' (disabled)' : ''}`,
  );
  act(() => select.closeDropdown());
  return options;
}

export function selectedLabel(label: string): string {
  return selectWrapper(label).findTrigger().getElement().textContent ?? '';
}

export function isSelectDisabled(label: string): boolean {
  return selectWrapper(label).isDisabled();
}

function dateWrapper(label: string) {
  const picker = createWrapper(document.body).findDatePicker(`[data-testid="${label}"]`);
  if (!picker) throw new Error(`No date picker labelled "${label}"`);
  return picker;
}

/** ISO `YYYY-MM-DD` from the picker's `YYYY/MM/DD` input. */
export function dateValue(label: string): string {
  return dateWrapper(label).findNativeInput().getElement().value.replaceAll('/', '-');
}

export function setDate(label: string, iso: string): void {
  const picker = dateWrapper(label);
  act(() => picker.setInputValue(iso.replaceAll('-', '/')));
}
