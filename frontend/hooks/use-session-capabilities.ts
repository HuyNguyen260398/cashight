'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionCapabilities } from '@cashight/domain/workspace';

import { apiFetch } from '@/frontend/api/client';
import { SessionCapabilitiesSchema } from '@/frontend/api/contracts';
import { useAuth } from '@/frontend/auth/auth-provider';
import { getPublicConfig } from '@/frontend/auth/config';

interface CapabilityCache {
  sessionKey: string;
  data?: SessionCapabilities;
  promise?: Promise<SessionCapabilities>;
}

interface CapabilityState {
  requestKey: string | null;
  data: SessionCapabilities | null;
  error: string | null;
}

let capabilityCache: CapabilityCache | undefined;

function loadCapabilities(sessionKey: string): Promise<SessionCapabilities> {
  if (capabilityCache?.sessionKey !== sessionKey) {
    capabilityCache = { sessionKey };
  }
  if (capabilityCache.data) return Promise.resolve(capabilityCache.data);
  if (capabilityCache.promise) return capabilityCache.promise;

  const { apiBaseUrl } = getPublicConfig();
  const promise = apiFetch(`${apiBaseUrl}/session/capabilities`)
    .then((response) => response.json())
    .then((raw) => SessionCapabilitiesSchema.parse(raw))
    .then((data) => {
      if (capabilityCache?.sessionKey === sessionKey) {
        capabilityCache = { sessionKey, data };
      }
      return data;
    })
    .catch((error: unknown) => {
      if (capabilityCache?.sessionKey === sessionKey) {
        capabilityCache = { sessionKey };
      }
      throw error;
    });
  capabilityCache = { sessionKey, promise };
  return promise;
}

export function useSessionCapabilities(): {
  data: SessionCapabilities | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const { user, loading: authLoading } = useAuth();
  const sessionKey = user?.profile.sub ?? null;
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const [state, setState] = useState<CapabilityState>({
    requestKey: null,
    data: null,
    error: null,
  });
  const requestKey = sessionKey ? `${sessionKey}:${reloadEpoch}` : null;

  useEffect(() => {
    if (authLoading) return;
    if (!sessionKey) {
      capabilityCache = undefined;
      return;
    }

    let cancelled = false;
    loadCapabilities(sessionKey)
      .then((data) => {
        if (!cancelled) {
          setState({ requestKey, data, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            requestKey,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load session capabilities',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, requestKey, sessionKey]);

  const reload = useCallback(() => {
    if (sessionKey && capabilityCache?.sessionKey === sessionKey) {
      capabilityCache = undefined;
    }
    setReloadEpoch((epoch) => epoch + 1);
  }, [sessionKey]);

  const stateIsCurrent = state.requestKey === requestKey;
  return {
    data: sessionKey && stateIsCurrent ? state.data : null,
    loading:
      authLoading ||
      (sessionKey !== null && !stateIsCurrent),
    error: sessionKey && stateIsCurrent ? state.error : null,
    reload,
  };
}
