'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'oidc-client-ts';
import { isDevAuthBypass } from './config';
import { getOidcManager } from './oidc';

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true });

/**
 * Stand-in session for `pnpm dev:local`, where the local API synthesizes
 * claims and there is no Cognito to sign in to. Only the fields the app reads
 * are populated; `apiFetch` sends no Authorization header under the bypass,
 * and the local server ignores it either way.
 */
const DEV_BYPASS_USER = {
  access_token: '',
  expired: false,
  profile: { sub: 'local-dev-user', email: 'local@dev.invalid' },
} as unknown as User;

/**
 * Wraps the app and restores the OIDC session from sessionStorage on mount.
 * If the stored user is expired it attempts a silent renewal; on failure the
 * session is cleared and the user is treated as unauthenticated.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Under the local bypass the session is known up front, so it seeds the
  // initial state rather than being set from the effect — no extra render,
  // and no flash of the unauthenticated redirect.
  const [state, setState] = useState<AuthState>(() =>
    isDevAuthBypass()
      ? { user: DEV_BYPASS_USER, loading: false }
      : { user: null, loading: true },
  );

  useEffect(() => {
    if (isDevAuthBypass()) return;

    const manager = getOidcManager();

    async function restoreSession() {
      try {
        let user = await manager.getUser();

        if (user?.expired) {
          try {
            user = await manager.signinSilent();
          } catch {
            await manager.removeUser();
            user = null;
          }
        }

        setState({ user: user ?? null, loading: false });
      } catch {
        setState({ user: null, loading: false });
      }
    }

    void restoreSession();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
