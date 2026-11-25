export interface FollowLike {
  detail: { href?: string; external?: boolean };
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
}

/**
 * True when a Cloudscape `onFollow` should be turned into a client-side
 * router push. Modified/non-left clicks and external links stay with the
 * browser so Cmd/Ctrl-click still opens a new tab.
 */
export function shouldHandleClientSide(event: FollowLike): boolean {
  const { href, external } = event.detail;
  if (!href || external || !href.startsWith('/')) return false;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
  return (event.button ?? 0) === 0;
}
