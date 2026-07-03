import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { getPublicConfig } from './config';

let _manager: UserManager | null = null;

/**
 * Return the singleton OIDC UserManager configured for Cognito PKCE.
 * Must only be called in a browser context (e.g. inside useEffect or a
 * click handler) — throws if called during SSR.
 */
export function getOidcManager(): UserManager {
  if (typeof window === 'undefined') {
    throw new Error('getOidcManager must only be called in a browser context');
  }

  if (_manager) return _manager;

  const config = getPublicConfig();

  _manager = new UserManager({
    authority: config.cognitoAuthority,
    client_id: config.cognitoClientId,
    redirect_uri: `${config.appOrigin}/auth/callback/`,
    post_logout_redirect_uri: `${config.appOrigin}/signin/`,
    response_type: 'code',
    scope: 'openid email profile cashight/read cashight/write',
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // Disable automatic silent renewal — we refresh explicitly before expiry
    // in AuthProvider using signinSilent().
    automaticSilentRenew: false,
  });

  return _manager;
}

/**
 * Sign out via Cognito's hosted-UI logout endpoint.
 *
 * Cognito's /logout is not a spec OIDC end_session_endpoint: it ignores
 * `id_token_hint` and `post_logout_redirect_uri` entirely and instead
 * requires its own `client_id` + `logout_uri` pair, with `logout_uri`
 * matched against the app client's Allowed sign-out URLs (see
 * https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html).
 * oidc-client-ts only ever sends the OIDC-standard param names — and even
 * auto-fills `client_id` solely for the case where `id_token_hint` is
 * absent — so both required params have to be forced through
 * extraQueryParams here, or Cognito 400s at its own /error page.
 */
export async function signOut(): Promise<void> {
  const manager = getOidcManager();
  const config = getPublicConfig();
  await manager.signoutRedirect({
    extraQueryParams: {
      client_id: config.cognitoClientId,
      logout_uri: manager.settings.post_logout_redirect_uri ?? '',
    },
  });
}
