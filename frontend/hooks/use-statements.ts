'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/frontend/api/client';
import { getPublicConfig } from '@/frontend/auth/config';
import { StatementsListResponseSchema } from '@/frontend/api/contracts';
import type { StatementRow } from '@/app/components/statements-table';

/**
 * Map a Lambda statement list item to the StatementRow shape used by
 * StatementsTable.  statementDate is "YYYY-MM-DD", statementId becomes key.
 */
function toStatementRow(item: {
  statementId: string;
  cardLast4: string;
  statementDate: string;
  totalSpend: number;
  uploadedAt: string;
}): StatementRow {
  const [yearStr, monthStr] = item.statementDate.split('-');
  return {
    key: item.statementId,
    cardLast4: item.cardLast4,
    year: parseInt(yearStr, 10),
    month: parseInt(monthStr, 10),
    totalSpend: item.totalSpend,
    uploadedAt: item.uploadedAt,
  };
}

type LoadedState = {
  epoch: number; // which request epoch produced this data
  items: StatementRow[];
  error: string | null;
  nextCursor: string | null;
};

/**
 * Load and manage the paginated statement list from `GET /statements`.
 *
 * `loading` is derived by comparing the current request epoch against the
 * epoch of the last loaded response — no synchronous setState inside effects.
 *
 * `loadMore` fetches the next page. `deleteStatement` removes a statement via
 * `DELETE /statements/{statementId}` and optimistically removes it from the
 * list. `refresh` reloads from the first page.
 */
export function useStatements(): {
  items: StatementRow[];
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  loadMore: () => void;
  deleteStatement: (key: string) => Promise<void>;
  refresh: () => void;
} {
  // Monotonically increasing counter; incrementing triggers a reload.
  const [requestEpoch, setRequestEpoch] = useState(0);

  const [loaded, setLoaded] = useState<LoadedState>({
    epoch: -1, // -1 = nothing loaded yet
    items: [],
    error: null,
    nextCursor: null,
  });

  // loading is true when the current epoch hasn't been resolved yet.
  const loading = loaded.epoch !== requestEpoch;

  useEffect(() => {
    let cancelled = false;
    const config = getPublicConfig();
    const epochAtStart = requestEpoch;

    apiFetch(`${config.apiBaseUrl}/statements`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const parsed = StatementsListResponseSchema.parse(json);
        setLoaded({
          epoch: epochAtStart,
          items: parsed.items.map(toStatementRow),
          error: null,
          nextCursor: parsed.nextCursor,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          epoch: epochAtStart,
          items: [],
          error:
            err instanceof Error ? err.message : 'Failed to load statements',
          nextCursor: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [requestEpoch]);

  const loadMore = useCallback(() => {
    if (!loaded.nextCursor || loading) return;

    const config = getPublicConfig();
    const cursor = loaded.nextCursor;

    apiFetch(
      `${config.apiBaseUrl}/statements?cursor=${encodeURIComponent(cursor)}`,
    )
      .then((res) => res.json())
      .then((json) => {
        const parsed = StatementsListResponseSchema.parse(json);
        setLoaded((prev) => ({
          ...prev,
          items: [...prev.items, ...parsed.items.map(toStatementRow)],
          nextCursor: parsed.nextCursor,
        }));
      })
      .catch((err: unknown) => {
        setLoaded((prev) => ({
          ...prev,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to load more statements',
        }));
      });
  }, [loaded.nextCursor, loading]);

  const deleteStatement = useCallback(async (key: string) => {
    const config = getPublicConfig();
    await apiFetch(
      `${config.apiBaseUrl}/statements/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
    // Optimistically remove from list.
    setLoaded((prev) => ({
      ...prev,
      items: prev.items.filter((row) => row.key !== key),
    }));
  }, []);

  const refresh = useCallback(() => {
    setRequestEpoch((n) => n + 1);
  }, []);

  return {
    items: loaded.items,
    loading,
    error: loaded.error,
    nextCursor: loaded.nextCursor,
    loadMore,
    deleteStatement,
    refresh,
  };
}
