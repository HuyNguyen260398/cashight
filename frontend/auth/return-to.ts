import { DEFAULT_DASHBOARD_HREF } from '@/frontend/lib/dashboard-routes';

export const OIDC_RETURN_ROUTES = [DEFAULT_DASHBOARD_HREF] as const;

export type OidcReturnRoute = (typeof OIDC_RETURN_ROUTES)[number];

export function allowlistedOidcReturnTo(
  value: unknown,
): OidcReturnRoute | null {
  return typeof value === 'string' &&
    (OIDC_RETURN_ROUTES as readonly string[]).includes(value)
    ? (value as OidcReturnRoute)
    : null;
}

export function resolveOidcCallbackReturn(state: unknown): OidcReturnRoute {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return DEFAULT_DASHBOARD_HREF;
  const returnTo = allowlistedOidcReturnTo(
    (state as { returnTo?: unknown }).returnTo,
  );
  return returnTo ?? DEFAULT_DASHBOARD_HREF;
}
