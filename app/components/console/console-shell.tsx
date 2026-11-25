'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AppLayout from '@cloudscape-design/components/app-layout';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import TopNavigation, { type TopNavigationProps } from '@cloudscape-design/components/top-navigation';

import { DEFAULT_DASHBOARD_HREF } from '@/frontend/lib/dashboard-routes';
import { shouldHandleClientSide, type FollowLike } from './follow';
import { NAV_ITEMS, activeHrefFor, pageLabelFor } from './nav-model';
import { ConsoleNotifications } from './notifications';
import {
  applyVisualSettings,
  loadVisualSettings,
  saveVisualSettings,
  type ModePreference,
  type VisualSettings,
} from './visual-settings';

const MODE_OPTIONS: ReadonlyArray<{ id: ModePreference; text: string }> = [
  { id: 'light', text: 'Light' },
  { id: 'dark', text: 'Dark' },
  { id: 'system', text: 'System' },
];

function useVisualSettings() {
  const [settings, setSettings] = useState<VisualSettings>(() => loadVisualSettings());
  useEffect(() => applyVisualSettings(settings), [settings]);
  function update(next: Partial<VisualSettings>) {
    const merged = { ...settings, ...next };
    saveVisualSettings(merged);
    setSettings(merged);
  }
  return [settings, update] as const;
}

const subscribeNoop = () => () => {};

/** False during prerender/hydration, true once mounted in the browser. */
function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

export function buildUtilities({
  email,
  settings,
  onSettingsChange,
  onSignOut,
  onFollow,
}: {
  email: string;
  settings: VisualSettings;
  onSettingsChange: (next: Partial<VisualSettings>) => void;
  onSignOut: () => void;
  onFollow?: (event: CustomEvent<FollowLike['detail']>) => void;
}): TopNavigationProps.Utility[] {
  return [
    {
      type: 'menu-dropdown',
      iconName: 'settings',
      title: 'Theme',
      ariaLabel: 'Theme',
      items: MODE_OPTIONS.map(({ id, text }) => ({ id, text, itemType: 'checkbox', checked: settings.mode === id })),
      onItemClick: ({ detail }) => onSettingsChange({ mode: detail.id as ModePreference }),
    },
    {
      type: 'menu-dropdown',
      text: email,
      iconName: 'user-profile',
      items: [
        { id: 'dashboard', text: 'Cost Explorer', href: DEFAULT_DASHBOARD_HREF },
        { id: 'signout', text: 'Sign out' },
      ],
      onItemClick: ({ detail }) => {
        if (detail.id === 'signout') onSignOut();
      },
      onItemFollow: (event) => onFollow?.(event as unknown as CustomEvent<FollowLike['detail']>),
    },
  ];
}

export function ConsoleShell({
  email,
  signOutAction,
  children,
}: {
  email: string;
  signOutAction: () => Promise<void>;
  children: ReactNode;
}) {
  const isClient = useIsClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [settings, updateSettings] = useVisualSettings();
  const activeHref = activeHrefFor(pathname, searchParams);
  const pageLabel = pageLabelFor(activeHref);

  function follow(event: CustomEvent<FollowLike['detail']>) {
    if (!shouldHandleClientSide({ detail: event.detail })) return;
    event.preventDefault();
    router.push(event.detail.href!);
  }

  const utilities = buildUtilities({
    email,
    settings,
    onSettingsChange: updateSettings,
    onSignOut: () => void signOutAction(),
    onFollow: follow,
  });

  // AppLayout's markup depends on browser-only measurements, so it never
  // renders during prerender/hydration (production only shows the shell after
  // the client-side sign-in check anyway).
  if (!isClient) return <>{children}</>;

  return (
    <>
      <div id="console-top-navigation" style={{ position: 'sticky', top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{ href: '/', title: 'Cashight', logo: { src: '/icon.svg', alt: 'Cashight' }, onFollow: follow }}
          utilities={utilities}
        />
      </div>
      <AppLayout
        headerSelector="#console-top-navigation"
        toolsHide
        navigation={
          <div data-testid="console-side-navigation">
            <SideNavigation items={NAV_ITEMS} activeHref={activeHref} onFollow={follow} />
          </div>
        }
        breadcrumbs={
          pageLabel ? (
            <BreadcrumbGroup
              items={[
                { text: 'Cashight', href: '/' },
                { text: pageLabel, href: activeHref! },
              ]}
              onFollow={follow}
            />
          ) : undefined
        }
        notifications={<ConsoleNotifications />}
        content={children}
      />
    </>
  );
}
