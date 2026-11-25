import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

const BANK_LINKS = [
  { text: 'TPB', bank: 'TPBank' },
  { text: 'VIB', bank: 'VIB' },
] as const;

/** Mirrors the shipped sidebar: Dashboard → AWS budget / Bank statements. */
export const NAV_ITEMS: SideNavigationProps.Item[] = [
  {
    type: 'section',
    text: 'Dashboard',
    defaultExpanded: true,
    items: [
      {
        type: 'section',
        text: 'AWS budget',
        defaultExpanded: true,
        items: [
          { type: 'link', text: 'Cost Explorer', href: '/aws/cost-explorer/' },
          { type: 'link', text: 'Billing Invoice', href: '/aws/billing-invoice/' },
        ],
      },
      {
        type: 'section',
        text: 'Bank statements',
        defaultExpanded: true,
        items: BANK_LINKS.map(({ text, bank }) => ({ type: 'link' as const, text, href: `/?bank=${bank}` })),
      },
    ],
  },
];

export function flattenLinks(items: readonly SideNavigationProps.Item[]): SideNavigationProps.Link[] {
  return items.flatMap((item) => {
    if (item.type === 'link') return [item];
    if ('items' in item) return flattenLinks(item.items);
    return [];
  });
}

const withSlash = (path: string) => (path.endsWith('/') ? path : `${path}/`);

/**
 * The href SideNavigation should highlight. Bank leaves differ only by
 * `?bank=`, so on `/` the bank param decides; elsewhere the path prefix does.
 */
export function activeHrefFor(pathname: string, search: URLSearchParams): string | undefined {
  if (pathname === '/') {
    const bank = search.get('bank');
    const match = BANK_LINKS.find((link) => link.bank === bank);
    return match ? `/?bank=${match.bank}` : undefined;
  }
  const path = withSlash(pathname);
  return flattenLinks(NAV_ITEMS).find((link) => !link.href.startsWith('/?') && path.startsWith(link.href))?.href;
}

export function pageLabelFor(activeHref: string | undefined): string | undefined {
  if (!activeHref) return undefined;
  return flattenLinks(NAV_ITEMS).find((link) => link.href === activeHref)?.text;
}
