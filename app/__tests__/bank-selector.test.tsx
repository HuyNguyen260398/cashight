// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import createWrapper from '@cloudscape-design/components/test-utils/dom';

import { BankSelector, bankOptions } from '@/app/components/bank-selector';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('period=month&year=2026&month=7'),
}));

describe('BankSelector', () => {
  // No vitest globals in this project, so Testing Library's auto-cleanup never
  // registers; without this, renders accumulate across tests.
  afterEach(cleanup);

  it('shows the short name of the selected bank', () => {
    render(<BankSelector current={'TPBank'} available={['TPBank', 'VIB']} />);
    expect(screen.getByText('TPB')).toBeTruthy();
  });

  it('offers no "all banks" choice — exactly one bank is always selected', () => {
    render(<BankSelector current={'TPBank'} available={['TPBank', 'VIB']} />);
    expect(screen.queryByText('All banks')).toBeNull();
  });

  it('is a Cloudscape select labelled for assistive technology', () => {
    const { container } = render(
      <BankSelector current={'VIB'} available={['VIB']} />,
    );
    const select = createWrapper(container).findSelect();
    expect(select).not.toBeNull();
    // Cloudscape names the trigger via aria-labelledby, so assert the accessible name.
    expect(screen.getByRole('button', { name: /Filter by bank/ })).toBe(select!.findTrigger().getElement());
  });

  it('switches bank while preserving the period params', () => {
    push.mockClear();
    const { container } = render(
      <BankSelector current={'TPBank'} available={['TPBank', 'VIB']} />,
    );
    const select = createWrapper(container).findSelect()!;
    select.openDropdown();
    select.selectOptionByValue('VIB');
    const url = new URLSearchParams(push.mock.calls[0][0].split('?')[1]);
    expect(url.get('bank')).toBe('VIB');
    expect(url.get('period')).toBe('month');
    expect(url.get('month')).toBe('7');
  });
});

describe('bankOptions', () => {
  // A period holding only VIB statements yields available=['VIB'] while the
  // default selection is still TPBank. Radix renders a blank trigger when the
  // value has no matching item, so the current bank must always be listed.
  it('includes the current bank even when the period lacks it', () => {
    expect(bankOptions('TPBank', ['VIB'])).toEqual(['TPBank', 'VIB']);
  });

  it('lists each bank once when the current bank is also available', () => {
    expect(bankOptions('VIB', ['TPBank', 'VIB'])).toEqual(['VIB', 'TPBank']);
  });

  it('puts the current bank first', () => {
    expect(bankOptions('VIB', ['TPBank'])[0]).toBe('VIB');
  });

  it('survives an empty available list (view still loading)', () => {
    expect(bankOptions('TPBank', [])).toEqual(['TPBank']);
  });
});
