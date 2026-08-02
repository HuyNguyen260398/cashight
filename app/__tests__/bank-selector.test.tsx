// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BankSelector } from '@/app/components/bank-selector';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('period=month&year=2026&month=7'),
}));

describe('BankSelector', () => {
  it('shows "All banks" when nothing is selected', () => {
    render(<BankSelector current={null} available={['TPBank', 'VIB']} />);
    expect(screen.getByText('All banks')).toBeTruthy();
  });

  it('shows the short name of the selected bank', () => {
    render(<BankSelector current={'TPBank'} available={['TPBank', 'VIB']} />);
    expect(screen.getByText('TPB')).toBeTruthy();
  });

  // Radix renders a native <select> alongside the visible trigger for form
  // compatibility, so the label matches twice — assert on the trigger itself.
  it('is labelled for assistive technology', () => {
    const { container } = render(
      <BankSelector current={null} available={['VIB']} />,
    );
    const trigger = container.querySelector('[data-slot="select-trigger"]');
    expect(trigger?.getAttribute('aria-label')).toBe('Filter by bank');
  });
});
