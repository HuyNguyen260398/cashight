import { describe, expect, it } from 'vitest';

import { NAV_ITEMS, activeHrefFor, flattenLinks, pageLabelFor } from '@/app/components/console/nav-model';
import { shouldHandleClientSide } from '@/app/components/console/follow';

const q = (s: string) => new URLSearchParams(s);

describe('nav model', () => {
  it('lists the leaf links in the shipped order and labels', () => {
    expect(flattenLinks(NAV_ITEMS).map((l) => [l.text, l.href])).toEqual([
      ['Cost Explorer', '/aws/cost-explorer/'],
      ['Billing Invoice', '/aws/billing-invoice/'],
      ['TPB', '/?bank=TPBank'],
      ['VIB', '/?bank=VIB'],
    ]);
  });

  it('marks the bank leaf on / regardless of other period params', () => {
    expect(activeHrefFor('/', q('bank=VIB&period=quarter&year=2026&quarter=2'))).toBe('/?bank=VIB');
    expect(activeHrefFor('/', q('bank=TPBank'))).toBe('/?bank=TPBank');
  });

  it('marks nothing on / without a known bank', () => {
    expect(activeHrefFor('/', q(''))).toBeUndefined();
    expect(activeHrefFor('/', q('bank=ACB'))).toBeUndefined();
  });

  it('marks AWS pages by path, ignoring ?bank= and trailing slashes', () => {
    expect(activeHrefFor('/aws/billing-invoice/', q('bank=VIB'))).toBe('/aws/billing-invoice/');
    expect(activeHrefFor('/aws/cost-explorer', q('report=x'))).toBe('/aws/cost-explorer/');
    expect(activeHrefFor('/signin', q(''))).toBeUndefined();
  });

  it('names the current page for breadcrumbs', () => {
    expect(pageLabelFor('/aws/cost-explorer/')).toBe('Cost Explorer');
    expect(pageLabelFor('/?bank=VIB')).toBe('VIB');
    expect(pageLabelFor(undefined)).toBeUndefined();
  });
});

describe('shouldHandleClientSide', () => {
  it('handles plain left clicks on internal links', () => {
    expect(shouldHandleClientSide({ detail: { href: '/aws/cost-explorer/' }, button: 0 })).toBe(true);
    expect(shouldHandleClientSide({ detail: { href: '/?bank=VIB' } })).toBe(true);
  });

  it('leaves modifier and non-left clicks to the browser', () => {
    const detail = { href: '/aws/cost-explorer/' };
    expect(shouldHandleClientSide({ detail, metaKey: true })).toBe(false);
    expect(shouldHandleClientSide({ detail, ctrlKey: true })).toBe(false);
    expect(shouldHandleClientSide({ detail, shiftKey: true })).toBe(false);
    expect(shouldHandleClientSide({ detail, button: 1 })).toBe(false);
  });

  it('leaves external or missing hrefs to the browser', () => {
    expect(shouldHandleClientSide({ detail: { href: '/x', external: true } })).toBe(false);
    expect(shouldHandleClientSide({ detail: { href: 'https://example.com/' } })).toBe(false);
    expect(shouldHandleClientSide({ detail: {} })).toBe(false);
  });
});
