// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PeriodSelector } from '@/app/components/period-selector';

const push = vi.fn();
let search = 'period=month&year=2026&month=7&bank=VIB';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
}));

describe('PeriodSelector', () => {
  beforeEach(() => {
    push.mockClear();
    search = 'period=month&year=2026&month=7&bank=VIB';
  });

  // This project does not enable vitest globals, so Testing Library never
  // registers its automatic cleanup — without this, renders accumulate and
  // later queries match elements from earlier tests.
  afterEach(cleanup);

  // Without this the bank silently resets on every period change: you pick
  // VIB, click next month, and land back on the default bank.
  it('preserves the selected bank when stepping to the next period', async () => {
    render(<PeriodSelector current={{ type: 'month', year: 2026, month: 7 }} />);
    await userEvent.click(screen.getByLabelText('Next period'));

    expect(push).toHaveBeenCalledTimes(1);
    const url = new URLSearchParams(push.mock.calls[0][0].split('?')[1]);
    expect(url.get('bank')).toBe('VIB');
    expect(url.get('month')).toBe('8');
    expect(url.get('year')).toBe('2026');
  });

  it('preserves the selected bank when stepping to the previous period', async () => {
    render(<PeriodSelector current={{ type: 'month', year: 2026, month: 7 }} />);
    await userEvent.click(screen.getByLabelText('Previous period'));

    const url = new URLSearchParams(push.mock.calls[0][0].split('?')[1]);
    expect(url.get('bank')).toBe('VIB');
    expect(url.get('month')).toBe('6');
  });

  it('omits the bank param when the URL never had one', async () => {
    search = 'period=month&year=2026&month=7';
    render(<PeriodSelector current={{ type: 'month', year: 2026, month: 7 }} />);
    await userEvent.click(screen.getByLabelText('Next period'));

    const url = new URLSearchParams(push.mock.calls[0][0].split('?')[1]);
    expect(url.get('bank')).toBeNull();
  });

  it('drops the month param when switching to a year view', async () => {
    render(<PeriodSelector current={{ type: 'month', year: 2026, month: 7 }} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Year' }));

    const url = new URLSearchParams(push.mock.calls[0][0].split('?')[1]);
    expect(url.get('period')).toBe('year');
    expect(url.get('month')).toBeNull();
    expect(url.get('bank')).toBe('VIB');
  });
});
