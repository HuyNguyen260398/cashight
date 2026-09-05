// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminShell } from '../components/admin-shell';
import { DashboardNav } from '../components/dashboard-nav';

let search = '';
let pathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

afterEach(cleanup);

describe('DashboardNav hierarchy and active routes', () => {
  beforeEach(() => {
    search = '';
    pathname = '/';
  });

  it('renders the approved bank and AWS hierarchy with exact leaf links', async () => {
    search = 'bank=VIB';
    render(<DashboardNav pathname="/" collapsed={false} />);

    expect(
      screen.getByRole('button', { name: 'Dashboard' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('button', { name: 'Bank statements' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'TPB' })).toHaveAttribute(
      'href',
      '/?bank=TPBank',
    );
    expect(screen.getByRole('link', { name: 'VIB' })).toHaveAttribute(
      'href',
      '/?bank=VIB',
    );
    expect(screen.getByRole('link', { name: 'VIB' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByText('All banks')).not.toBeInTheDocument();

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Cost Explorer', 'Billing Invoice', 'TPB', 'VIB',
    ]);
    expect(screen.getByRole('link', { name: 'Cost Explorer' })).toHaveAttribute(
      'href',
      '/aws/cost-explorer',
    );
    expect(
      screen.getByRole('link', { name: 'Billing Invoice' }),
    ).toHaveAttribute('href', '/aws/billing-invoice');
  });

  it('allows collapsing active ancestors and reopens them for another route', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DashboardNav pathname="/aws/cost-explorer/" collapsed={false} />);
    await user.click(screen.getByRole('button', { name: 'AWS budget' }));
    expect(screen.queryByRole('link', { name: 'Cost Explorer' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-expanded', 'false');
    rerender(<DashboardNav pathname="/aws/billing-invoice/" collapsed={false} />);
    expect(screen.getByRole('link', { name: 'Billing Invoice' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'TPB' })).toBeVisible();
  });

  it('automatically expands and marks an active AWS descendant', () => {
    render(
      <DashboardNav pathname="/aws/cost-explorer/" collapsed={false} />,
    );

    expect(
      screen.getByRole('button', { name: 'AWS budget' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('link', { name: 'Cost Explorer' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

describe('DashboardNav accessibility interactions', () => {
  beforeEach(() => {
    search = '';
    pathname = '/';
  });

  it('toggles expanded disclosures with Enter and Space', async () => {
    const user = userEvent.setup();
    render(<DashboardNav pathname="/statements/" collapsed={false} />);
    const dashboard = screen.getByRole('button', { name: 'Dashboard' });

    dashboard.focus();
    await user.keyboard('{Enter}');
    expect(dashboard).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(dashboard).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the collapsed flyout without hover and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(<DashboardNav pathname="/" collapsed />);
    const dashboard = screen.getByRole('button', { name: 'Dashboard' });

    await user.click(dashboard);
    expect(dashboard).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Dashboard' });
    expect(within(menu).getByRole('menuitem', { name: 'TPB' })).toBeVisible();

    await user.keyboard('{Escape}');
    expect(dashboard).toHaveAttribute('aria-expanded', 'false');
    expect(dashboard).toHaveFocus();
  });

  it('calls mobile navigation callback only after a leaf is selected', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <DashboardNav
        pathname="/statements/"
        collapsed={false}
        onNavigate={onNavigate}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Bank statements' }));
    await user.click(screen.getByRole('button', { name: 'Bank statements' }));
    expect(onNavigate).not.toHaveBeenCalled();
    const tpbLink = screen.getByRole('link', { name: 'TPB' });
    tpbLink.addEventListener('click', (event) => event.preventDefault());
    await user.click(tpbLink);
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});

describe('AdminShell navigation integration', () => {
  it('preserves the existing top-level Upload and Statements utilities', () => {
    render(
      <AdminShell email="huy@example.com" signOutAction={vi.fn()}>
        <main>Content</main>
      </AdminShell>,
    );

    const desktopNavigation = screen.getAllByRole('navigation')[0];
    expect(
      within(desktopNavigation).getByRole('link', { name: /Upload/ }),
    ).toHaveAttribute('href', '/upload');
    expect(
      within(desktopNavigation).getByRole('link', { name: /Statements/ }),
    ).toHaveAttribute('href', '/statements');
  });
});
