'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';

const navItems = [
  {
    href: '/',
    label: 'Dashboard',
    description: 'Spend overview',
    icon: LayoutDashboard,
  },
  {
    href: '/upload',
    label: 'Upload',
    description: 'Parse PDF',
    icon: UploadCloud,
  },
  {
    href: '/statements',
    label: 'Statements',
    description: 'Saved months',
    icon: FileText,
  },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function initialsFor(email: string) {
  const [name] = email.split('@');
  const parts = name.split(/[._-]/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

  return (initials || email[0] || 'U').toUpperCase();
}

function SidebarToggleIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 16 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SidebarContent({
  pathname,
  collapsed = false,
  onNavigate,
}: {
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          'flex h-[73px] items-center border-b border-gray-200 px-5 dark:border-gray-800',
          collapsed && 'justify-center px-3',
        )}
      >
        <Link
          href="/"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-3"
          aria-label="Cashight dashboard"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-theme-xs">
            <BarChart3 className="size-5" aria-hidden />
          </span>
          {!collapsed ? (
            <span className="min-w-0">
              <span className="block truncate text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
                Cashight
              </span>
              <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                Expense intelligence
              </span>
            </span>
          ) : null}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-6">
        <ul className="flex flex-col gap-2">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    collapsed && 'justify-center px-2',
                    active
                      ? 'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-5 shrink-0',
                      active
                        ? 'text-brand-500 dark:text-brand-400'
                        : 'text-gray-500 group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-300',
                    )}
                    aria-hidden
                  />
                  {!collapsed ? (
                    <span className="min-w-0">
                      <span className="block truncate">{item.label}</span>
                      <span className="block truncate text-xs font-normal text-gray-500 dark:text-gray-400">
                        {item.description}
                      </span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function UserDropdown({
  email,
  signOutAction,
}: {
  email: string;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const initials = initialsFor(email);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const itemClassName =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300';
  const iconClassName = 'size-5 text-gray-500 dark:text-gray-400';

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        className="flex min-h-11 items-center gap-3 rounded-lg px-1.5 py-1 text-left text-gray-700 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-3 focus-visible:ring-brand-500/15 dark:text-gray-300 dark:hover:bg-white/5"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-600 ring-1 ring-brand-500/10 dark:bg-brand-500/15 dark:text-brand-300">
          {initials}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-48 truncate text-sm font-medium text-gray-800 dark:text-gray-200">
            {email}
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Private workspace
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-gray-500 transition-transform duration-200 dark:text-gray-400',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-4 flex w-[260px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="px-2 pb-3">
            <span className="block truncate text-sm font-medium text-gray-700 dark:text-gray-300">
              {email}
            </span>
            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
              Cashight account
            </span>
          </div>

          <ul className="flex flex-col gap-1 border-y border-gray-200 py-3 dark:border-gray-800">
            <li>
              <Link
                href="/upload"
                role="menuitem"
                className={itemClassName}
                onClick={() => setOpen(false)}
              >
                <UploadCloud className={iconClassName} aria-hidden />
                Upload statement
              </Link>
            </li>
            <li>
              <Link
                href="/statements"
                role="menuitem"
                className={itemClassName}
                onClick={() => setOpen(false)}
              >
                <FileText className={iconClassName} aria-hidden />
                Statements
              </Link>
            </li>
            <li>
              <Link
                href="/"
                role="menuitem"
                className={itemClassName}
                onClick={() => setOpen(false)}
              >
                <ShieldCheck className={iconClassName} aria-hidden />
                Spending dashboard
              </Link>
            </li>
          </ul>

          <form action={signOutAction} className="pt-3">
            <button
              type="submit"
              role="menuitem"
              className={itemClassName}
              onClick={() => setOpen(false)}
            >
              <LogOut className={iconClassName} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function AdminShell({
  children,
  email,
  signOutAction,
}: {
  children: ReactNode;
  email: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen && !mobileMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, mobileMenuOpen]);

  return (
    <div className="min-h-dvh bg-gray-50 text-gray-800 dark:bg-gray-950 dark:text-white/90">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden border-r border-gray-200 bg-white transition-[width] duration-300 dark:border-gray-800 dark:bg-gray-900 lg:block',
          collapsed ? 'w-[90px]' : 'w-[290px]',
        )}
      >
        <SidebarContent pathname={pathname} collapsed={collapsed} />
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 mt-16 flex h-[calc(100dvh-4rem)] w-[290px] flex-col border-r border-gray-200 bg-white shadow-theme-lg transition-transform duration-300 dark:border-gray-800 dark:bg-gray-900 lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarContent
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
        />
      </aside>

      <div
        className={cn(
          'min-h-dvh transition-[padding] duration-300',
          collapsed ? 'lg:pl-[90px]' : 'lg:pl-[290px]',
        )}
      >
        <header className="sticky top-0 z-50 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex min-h-[73px] flex-col lg:flex-row">
            <div className="flex h-16 items-center justify-between gap-3 border-b border-gray-200 px-3 dark:border-gray-800 sm:gap-4 sm:px-4 lg:h-[73px] lg:border-b-0 lg:px-6">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="rounded-full border-gray-200 bg-transparent text-gray-500 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/5 lg:hidden"
                  aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
                  onClick={() => setMobileOpen((value) => !value)}
                >
                  {mobileOpen ? (
                    <X className="size-5" aria-hidden />
                  ) : (
                    <SidebarToggleIcon />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="hidden rounded-full border-gray-200 bg-transparent text-gray-500 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/5 lg:inline-flex"
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  onClick={() => setCollapsed((value) => !value)}
                >
                  <SidebarToggleIcon />
                </Button>
              </div>

              <Link
                href="/"
                className="flex min-w-0 items-center gap-3 lg:hidden"
                aria-label="Cashight dashboard"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-theme-xs">
                  <BarChart3 className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-gray-900 dark:text-white">
                    Cashight
                  </span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    Expense intelligence
                  </span>
                </span>
              </Link>

              <Button
                variant="ghost"
                size="icon-lg"
                className="rounded-full text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
                aria-label={mobileMenuOpen ? 'Close app menu' : 'Open app menu'}
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen((value) => !value)}
              >
                <MoreHorizontal className="size-5" aria-hidden />
              </Button>
            </div>

            <div
              className={cn(
                'items-center justify-between gap-3 px-5 py-4 shadow-theme-md lg:flex lg:flex-1 lg:justify-end lg:px-6 lg:py-3 lg:shadow-none',
                mobileMenuOpen ? 'flex' : 'hidden',
              )}
            >
              <ThemeToggle className="size-10 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5 lg:hidden" />
              <ThemeToggle className="hidden size-11 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5 lg:inline-flex" />
              <UserDropdown email={email} signOutAction={signOutAction} />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-(--breakpoint-2xl) p-4 md:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
