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
    redirect_uri: `${config.appOrigin}/auth/callback`,
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
