'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/frontend/api/client';
import type { StatementListItem } from '@/frontend/api/contracts';
import { getPublicConfig } from '@/frontend/auth/config';
import { loadStatementHistory } from '@/frontend/lib/statement-history';

/** One complete metadata snapshot shared by initial navigation and bank history. */
export function useBankStatements() {
  const [state, setState] = useState({
    items: [] as StatementListItem[],
    loading: true,
    refreshing: false,
    error: null as string | null,
  });
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (): Promise<StatementListItem[]> => {
    const current = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState((previous) => ({ ...previous, refreshing: true, error: null }));
    try {
      const items = await loadStatementHistory(request.signal);
      if (!mounted.current || current !== generation.current) {
        throw new DOMException('Superseded request', 'AbortError');
      }
      setState({ items, loading: false, refreshing: false, error: null });
      return items;
    } catch (error) {
      if (mounted.current && current === generation.current) {
        setState((previous) => ({
          ...previous, loading: false, refreshing: false,
          error: error instanceof Error ? error.message : 'Could not load statement history.',
        }));
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    return () => {
      mounted.current = false;
      generation.current += 1;
      controller.current?.abort();
    };
  }, [refresh]);

  const deleteStatement = useCallback(async (id: string): Promise<void> => {
    await apiFetch(`${getPublicConfig().apiBaseUrl}/statements/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!mounted.current) return;
    // Invalidate even a refresh started while DELETE was in flight.
    generation.current += 1;
    controller.current?.abort();
    setState((previous) => ({
      ...previous,
      items: previous.items.filter((item) => item.statementId !== id),
      loading: false, refreshing: false,
    }));
  }, []);

  return { ...state, refresh, deleteStatement };
}
