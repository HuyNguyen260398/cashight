// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let search = '';
let pathname = '/';
const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/app/components/console/visual-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/console/visual-settings')>();
  return {
    ...actual,
    loadVisualSettings: vi.fn(() => ({ mode: 'light' })),
    saveVisualSettings: vi.fn(),
    applyVisualSettings: vi.fn(() => () => {}),
  };
});

import type { ButtonDropdownProps } from '@cloudscape-design/components/button-dropdown';
import type { TopNavigationProps } from '@cloudscape-design/components/top-navigation';
import { disableMotion } from '@cloudscape-design/global-styles';
import { ConsoleShell, buildUtilities } from '@/app/components/console/console-shell';
import { clearNotifications, notify } from '@/app/components/console/notifications';
import { applyVisualSettings } from '@/app/components/console/visual-settings';

function renderShell(signOutAction = vi.fn(async () => {})) {
  render(
    <ConsoleShell email="huy@example.com" signOutAction={signOutAction}>
      <p>Page content</p>
    </ConsoleShell>,
  );
  return signOutAction;
}

beforeEach(() => {
  // Flashbar keeps removed items mounted until a CSS transition ends, which jsdom never fires.
  disableMotion(true);
  search = '';
  pathname = '/aws/cost-explorer/';
  push.mockClear();
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  act(() => clearNotifications());
  cleanup();
  vi.useRealTimers();
});

describe('ConsoleShell', () => {
  it('renders the Cashight identity, page content and the nav leaves', () => {
    renderShell();
    expect(screen.getAllByText('Cashight').length).toBeGreaterThan(0);
    expect(screen.getByText('Page content')).toBeInTheDocument();
    for (const name of ['Cost Explorer', 'Billing Invoice', 'TPB', 'VIB']) {
      expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText(/amazon|aws console/i)).not.toBeInTheDocument();
  });

  it('marks the bank leaf from ?bank= on /', () => {
    pathname = '/';
    search = 'bank=VIB&period=month&year=2026&month=7';
    renderShell();
    const vib = screen.getAllByRole('link', { name: 'VIB' }).find((el) => el.getAttribute('aria-current') === 'page');
    expect(vib).toBeDefined();
    expect(screen.getAllByRole('link', { name: 'TPB' }).every((el) => el.getAttribute('aria-current') !== 'page')).toBe(true);
  });

  it('routes plain nav clicks through the Next router', async () => {
    renderShell();
    await userEvent.click(screen.getAllByRole('link', { name: 'Billing Invoice' })[0]);
    expect(push).toHaveBeenCalledWith('/aws/billing-invoice/');
  });

  it('applies the saved visual settings on mount', () => {
    renderShell();
    expect(applyVisualSettings).toHaveBeenCalledWith({ mode: 'light' });
  });
});

describe('buildUtilities', () => {
  type MenuUtility = Extract<TopNavigationProps.Utility, { type: 'menu-dropdown' }>;
  function setup(settings = { mode: 'light' as const }) {
    const onSettingsChange = vi.fn();
    const onSignOut = vi.fn();
    const utilities = buildUtilities({ email: 'huy@example.com', settings, onSettingsChange, onSignOut }) as MenuUtility[];
    const byTitle = (title: string) => utilities.find((u) => u.title === title || u.text === title)!;
    const click = (u: MenuUtility, id: string) =>
      u.onItemClick!(new CustomEvent('click', { detail: { id } }) as CustomEvent<ButtonDropdownProps.ItemClickDetails>);
    return { utilities, byTitle, click, onSettingsChange, onSignOut };
  }

  it('offers Light, Dark and System with the current one checked', () => {
    const { byTitle } = setup();
    expect(byTitle('Theme').items).toEqual([
      expect.objectContaining({ id: 'light', text: 'Light', checked: true }),
      expect.objectContaining({ id: 'dark', text: 'Dark', checked: false }),
      expect.objectContaining({ id: 'system', text: 'System', checked: false }),
    ]);
  });

  it('reports a mode change', () => {
    const { byTitle, click, onSettingsChange } = setup();
    click(byTitle('Theme'), 'dark');
    expect(onSettingsChange).toHaveBeenCalledWith({ mode: 'dark' });
  });

  it('offers no density toggle', () => {
    const { utilities } = setup();
    expect(utilities.map((u) => u.title ?? u.text)).toEqual(['Theme', 'huy@example.com']);
  });

  it('signs out from the user menu labelled with the email', () => {
    const { byTitle, click, onSignOut } = setup();
    const user = byTitle('huy@example.com');
    expect(user.items).toEqual([
      expect.objectContaining({ text: 'Cost Explorer', href: '/aws/cost-explorer/' }),
      expect.objectContaining({ id: 'signout', text: 'Sign out' }),
    ]);
    click(user, 'signout');
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe('notifications', () => {
  it('shows notify() messages in the flashbar and auto-dismisses success after 5 s', () => {
    vi.useFakeTimers();
    renderShell();
    act(() => notify({ type: 'success', content: 'Statement deleted' }));
    expect(screen.getByText('Statement deleted')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText('Statement deleted')).not.toBeInTheDocument();
  });

  it('keeps errors until dismissed', async () => {
    renderShell();
    act(() => notify({ type: 'error', content: 'Could not delete statement' }));
    expect(screen.getByText('Could not delete statement')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Could not delete statement')).not.toBeInTheDocument();
  });
});
