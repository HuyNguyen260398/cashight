'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LayoutDashboard } from 'lucide-react';

import { cn } from '@/lib/utils';

const dashboardGroups = [
  {
    id: 'aws-budget',
    label: 'AWS budget',
    children: [
      { label: 'Cost Explorer', href: '/aws/cost-explorer/' },
      { label: 'Billing Invoice', href: '/aws/billing-invoice/' },
    ],
  },
  {
    id: 'bank-statements',
    label: 'Bank statements',
    children: [
      { label: 'TPB', href: '/?bank=TPBank', bank: 'TPBank' },
      { label: 'VIB', href: '/?bank=VIB', bank: 'VIB' },
    ],
  },
] as const;

type GroupId = (typeof dashboardGroups)[number]['id'];

function activeGroupFor(pathname: string, bank: string | null): GroupId | null {
  if (pathname.startsWith('/aws/')) return 'aws-budget';
  if (pathname === '/' && (bank === 'TPBank' || bank === 'VIB')) {
    return 'bank-statements';
  }
  return null;
}

function leafIsActive(
  pathname: string,
  bank: string | null,
  leaf: (typeof dashboardGroups)[number]['children'][number],
): boolean {
  if ('bank' in leaf) return pathname === '/' && bank === leaf.bank;
  return pathname === leaf.href || pathname.startsWith(leaf.href);
}

type DashboardNavProps = {
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
};

export function DashboardNav(props: DashboardNavProps) {
  const searchParams = useSearchParams();
  const bank = searchParams.get('bank');
  return <DashboardNavTree key={`${props.pathname}:${bank}`} {...props} bank={bank} />;
}

function DashboardNavTree({ pathname, collapsed, onNavigate, bank }: DashboardNavProps & { bank: string | null }) {
  const activeGroup = activeGroupFor(pathname, bank);
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<GroupId, boolean>>({
    'bank-statements': true,
    'aws-budget': true,
  });
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const flyoutButtonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const dashboardExpanded = dashboardOpen;

  useEffect(() => {
    if (!flyoutOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFlyoutOpen(false);
      flyoutButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [flyoutOpen]);

  function selectLeaf() {
    setFlyoutOpen(false);
    onNavigate?.();
  }

  if (collapsed) {
    return (
      <li className="relative">
        <button
          ref={flyoutButtonRef}
          type="button"
          aria-label="Dashboard"
          aria-haspopup="menu"
          aria-expanded={flyoutOpen}
          aria-controls={`${id}-dashboard-flyout`}
          title="Dashboard"
          onClick={() => setFlyoutOpen((open) => !open)}
          className={cn(
            'flex min-h-11 w-full items-center justify-center rounded-lg px-2 text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white',
            activeGroup &&
              'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400',
          )}
        >
          <LayoutDashboard className="size-5" aria-hidden />
        </button>

        {flyoutOpen ? (
          <div
            id={`${id}-dashboard-flyout`}
            role="menu"
            aria-label="Dashboard"
            className="absolute left-full top-0 z-50 ml-3 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
          >
            {dashboardGroups.map((group) => (
              <div key={group.id} className="not-last:mb-3">
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {group.label}
                </p>
                <ul className="space-y-1">
                  {group.children.map((leaf) => {
                    const active = leafIsActive(pathname, bank, leaf);
                    return (
                      <li key={leaf.href}>
                        <Link
                          href={leaf.href}
                          role="menuitem"
                          aria-current={active ? 'page' : undefined}
                          onClick={selectLeaf}
                          className={cn(
                            'flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-300 dark:hover:bg-white/5',
                            active &&
                              'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400',
                          )}
                        >
                          {leaf.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={dashboardExpanded}
        aria-controls={`${id}-dashboard-groups`}
        onClick={() => setDashboardOpen((open) => !open)}
        className={cn(
          'group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white',
          activeGroup &&
            'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400',
        )}
      >
        <LayoutDashboard className="size-5 shrink-0" aria-hidden />
        <span className="flex-1">Dashboard</span>
        <ChevronDown
          className={cn(
            'size-4 transition-transform duration-200',
            dashboardExpanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {dashboardExpanded ? (
        <div id={`${id}-dashboard-groups`} className="ml-4 mt-1 border-l border-gray-200 pl-3 dark:border-gray-800">
          {dashboardGroups.map((group) => {
            const expanded = openGroups[group.id];
            return (
              <div key={group.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`${id}-${group.id}`}
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [group.id]: !expanded,
                    }))
                  }
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
                >
                  <span className="flex-1">{group.label}</span>
                  <ChevronDown
                    className={cn(
                      'size-4 transition-transform duration-200',
                      expanded && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </button>

                {expanded ? (
                  <ul id={`${id}-${group.id}`} className="mb-1 space-y-1">
                    {group.children.map((leaf) => {
                      const active = leafIsActive(pathname, bank, leaf);
                      return (
                        <li key={leaf.href}>
                          <Link
                            href={leaf.href}
                            aria-current={active ? 'page' : undefined}
                            onClick={selectLeaf}
                            className={cn(
                              'flex min-h-11 items-center rounded-lg px-3 pl-5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white',
                              active &&
                                'bg-brand-50 font-medium text-brand-500 dark:bg-brand-500/15 dark:text-brand-400',
                            )}
                          >
                            {leaf.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}
