'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AggregatedView } from '@/lib/aggregations';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiRequestError } from '@/frontend/api/client';
import { getPublicConfig } from '@/frontend/auth/config';

type State =
  | { phase: 'idle' }
  | { phase: 'loading'; text: string }
  | { phase: 'error'; message: string }
  | { phase: 'done'; text: string };

type Action =
  | { type: 'START' }
  | { type: 'APPEND'; chunk: string }
  | { type: 'ERROR'; message: string }
  | { type: 'DONE' }
  | { type: 'RESET' }
  | { type: 'CACHED'; text: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START':
      return { phase: 'loading', text: '' };
    case 'APPEND':
      if (state.phase !== 'loading') return state;
      return { phase: 'loading', text: state.text + action.chunk };
    case 'ERROR':
      return { phase: 'error', message: action.message };
    case 'DONE':
      if (state.phase !== 'loading') return state;
      return { phase: 'done', text: state.text };
    case 'CACHED':
      return { phase: 'done', text: action.text };
    case 'RESET':
      return { phase: 'idle' };
    default:
      return state;
  }
}

export function AiSummaryCard({ view }: { view: AggregatedView }) {
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' });

  // Stable key for the current period — drives cache lookups and reset.
  const specKey = JSON.stringify(view.spec);

  const isEmpty = view.statementCount === 0 || view.transactions.length === 0;

  // In-component cache of completed summary text keyed by spec, so navigating
  // back to an already-summarized period shows the cached text without
  // re-calling Gemini.
  const cacheRef = useRef<Map<string, string>>(new Map());

  // Holds the AbortController for any in-flight request so we can cancel on
  // period change or unmount.
  const acRef = useRef<AbortController | null>(null);

  // Depends on `view` so it always serializes the current period. This callback
  // is only invoked from click handlers (never inside an effect dependency
  // array), so recreating it per view change is harmless.
  const runSummary = useCallback(async () => {
    // Abort any previous in-flight request before starting a new one.
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    const key = JSON.stringify(view.spec);

    dispatch({ type: 'START' });

    try {
      // Build period query params for GET /summaries.
      const periodParams = new URLSearchParams();
      if (view.spec.type === 'month') {
        periodParams.set('period', 'month');
        periodParams.set('year', String(view.spec.year));
        periodParams.set('month', String(view.spec.month));
      } else if (view.spec.type === 'quarter') {
        periodParams.set('period', 'quarter');
        periodParams.set('year', String(view.spec.year));
        periodParams.set('quarter', String(view.spec.quarter));
      } else {
        periodParams.set('period', 'year');
        periodParams.set('year', String(view.spec.year));
      }

      const config = getPublicConfig();
      const res = await apiFetch(
        `${config.apiBaseUrl}/summaries?${periodParams.toString()}`,
        { signal: ac.signal },
      );

      if (!res.body) {
        dispatch({
          type: 'ERROR',
          message: 'Could not generate summary — try again.',
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        text += chunk;
        dispatch({ type: 'APPEND', chunk });
      }

      cacheRef.current.set(key, text);
      dispatch({ type: 'DONE' });
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      if (err instanceof ApiRequestError) {
        let message: string;
        if (err.status === 429) {
          message = 'The AI is busy right now — try again in a minute.';
        } else if (err.status === 503) {
          message = 'AI summary is not configured.';
        } else {
          message = 'Could not generate summary.';
        }
        dispatch({ type: 'ERROR', message });
        return;
      }
      dispatch({
        type: 'ERROR',
        message:
          'Could not reach the summary service. Check your connection and try again.',
      });
    }
  }, [view]);

  // When the period changes: abort any in-flight request, then either show the
  // cached summary (if this period was already summarized) or reset to idle so
  // the user must click to summarize the new period. Never auto-fetches.
  useEffect(() => {
    acRef.current?.abort();
    acRef.current = null;

    const cached = cacheRef.current.get(specKey);
    if (cached !== undefined) {
      dispatch({ type: 'CACHED', text: cached });
      return;
    }

    dispatch({ type: 'RESET' });
  }, [specKey]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      acRef.current?.abort();
    };
  }, []);

  return (
    <Card className="h-full min-h-0 gap-0">
      <CardHeader className="shrink-0 border-b border-gray-100 dark:border-gray-800">
        <CardTitle>AI summary</CardTitle>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Privacy-preserving aggregate insight.
        </p>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pt-5">
        {isEmpty ? (
          <p className="text-muted-foreground text-sm">
            No spending data to summarize for this period.
          </p>
        ) : state.phase === 'idle' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Generate an AI overview of {view.label} spending.
            </p>
            <Button onClick={() => void runSummary()}>
              Summarize expenses with AI
            </Button>
          </div>
        ) : state.phase === 'loading' ? (
          state.text ? (
            <div className="prose prose-sm max-w-none whitespace-pre-wrap">
              {state.text}
            </div>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[90%]" />
              <Skeleton className="h-4 w-[80%]" />
              <Skeleton className="h-4 w-[85%]" />
            </div>
          )
        ) : state.phase === 'error' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-destructive text-sm">{state.message}</p>
            <Button variant="outline" onClick={() => void runSummary()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="prose prose-sm max-w-none whitespace-pre-wrap">
              {state.text}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => void runSummary()}
            >
              Regenerate
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
