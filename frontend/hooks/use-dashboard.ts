'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/frontend/api/client';
import { getPublicConfig } from '@/frontend/auth/config';
import { AggregatedViewSchema } from '@cashight/domain/schemas';
import type { AggregatedView } from '@cashight/domain/aggregations';
import type { PeriodSpec } from '@cashight/domain/period';
import type { BankCode } from '@/lib/banks';

function buildDashboardParams(
  spec: PeriodSpec,
  bank: BankCode | null,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('period', spec.type);
  params.set('year', String(spec.year));
  if (spec.type === 'month') params.set('month', String(spec.month));
  if (spec.type === 'quarter') params.set('quarter', String(spec.quarter));
  if (bank) params.set('bank', bank);
  return params;
}

type LoadedState = {
  requestKey: string | null;
  data: AggregatedView | null;
  error: string | null;
};

/**
 * Fetch `GET /dashboard` for the given period spec and bank filter. Pass a null
 * spec to skip the fetch (e.g. while waiting for a redirect). A null bank omits
 * the query param, leaving the API to apply its default bank — the dashboard
 * always views exactly one bank, never a combined total.
 *
 * `loading` is derived from whether the currently-requested requestKey has been
 * loaded yet — no synchronous setState is called inside the effect.
 */
export function useDashboard(
  spec: PeriodSpec | null,
  bank: BankCode | null = null,
): {
  data: AggregatedView | null;
  loading: boolean;
  error: string | null;
} {
  // Track what was last successfully (or erroneously) loaded.
  const [loaded, setLoaded] = useState<LoadedState>({
    requestKey: null,
    data: null,
    error: null,
  });

  // Stable string key for the current request. `bank` is included so switching
  // banks refetches rather than reusing the previous view.
  const requestKey = spec ? JSON.stringify({ spec, bank }) : null;

  // Loading is true when we have a request that hasn't been loaded yet.
  const loading = requestKey !== null && loaded.requestKey !== requestKey;

  useEffect(() => {
    if (!requestKey || !spec) return;

    let cancelled = false;
    const config = getPublicConfig();
    const params = buildDashboardParams(spec, bank);

    apiFetch(`${config.apiBaseUrl}/dashboard?${params.toString()}`)
      .then((res) => res.json())
      .then((raw) => {
        const data = AggregatedViewSchema.parse(raw) as AggregatedView;
        if (!cancelled) {
          setLoaded({ requestKey, data, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({
            requestKey,
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
    // requestKey encodes spec and bank; including them would cause spurious re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Only expose data/error for the currently-requested view. While a new
  // request is loading, the previous data is stale — return null instead.
  const isCurrent = loaded.requestKey === requestKey;
  return {
    data: isCurrent ? loaded.data : null,
    loading,
    error: isCurrent ? loaded.error : null,
  };
}
