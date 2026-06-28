'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/frontend/api/client';
import { getPublicConfig } from '@/frontend/auth/config';
import type { AggregatedView } from '@cashight/domain/aggregations';
import type { PeriodSpec } from '@cashight/domain/period';

function buildPeriodParams(spec: PeriodSpec): URLSearchParams {
  const params = new URLSearchParams();
  params.set('period', spec.type);
  params.set('year', String(spec.year));
  if (spec.type === 'month') params.set('month', String(spec.month));
  if (spec.type === 'quarter') params.set('quarter', String(spec.quarter));
  return params;
}

type LoadedState = {
  specKey: string | null;
  data: AggregatedView | null;
  error: string | null;
};

/**
 * Fetch `GET /dashboard` for the given period spec. Pass `null` to skip the
 * fetch (e.g. while waiting for a redirect).
 *
 * `loading` is derived from whether the currently-requested specKey has been
 * loaded yet — no synchronous setState is called inside the effect.
 */
export function useDashboard(spec: PeriodSpec | null): {
  data: AggregatedView | null;
  loading: boolean;
  error: string | null;
} {
  // Track what was last successfully (or erroneously) loaded.
  const [loaded, setLoaded] = useState<LoadedState>({
    specKey: null,
    data: null,
    error: null,
  });

  // Stable string key for the current spec.
  const specKey = spec ? JSON.stringify(spec) : null;

  // Loading is true when we have a spec that hasn't been loaded yet.
  const loading = specKey !== null && loaded.specKey !== specKey;

  useEffect(() => {
    if (!specKey || !spec) return;

    let cancelled = false;
    const config = getPublicConfig();
    const params = buildPeriodParams(spec);

    apiFetch(`${config.apiBaseUrl}/dashboard?${params.toString()}`)
      .then((res) => res.json() as Promise<AggregatedView>)
      .then((json) => {
        if (!cancelled) {
          setLoaded({ specKey, data: json, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({
            specKey,
            data: null,
            error:
              err instanceof Error
                ? err.message
                : 'Failed to load dashboard',
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // specKey encodes spec; including spec would cause spurious re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  // Only expose data/error for the currently-requested spec. While a new
  // spec is loading, the previous data is stale — return null instead.
  const isCurrent = loaded.specKey === specKey;
  return {
    data: isCurrent ? loaded.data : null,
    loading,
    error: isCurrent ? loaded.error : null,
  };
}
