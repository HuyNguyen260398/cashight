'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'oidc-client-ts';
import { getOidcManager } from './oidc';

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true });

/**
 * Wraps the app and restores the OIDC session from sessionStorage on mount.
 * If the stored user is expired it attempts a silent renewal; on failure the
 * session is cleared and the user is treated as unauthenticated.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
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
