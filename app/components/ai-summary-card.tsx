'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AggregatedView } from '@/lib/aggregations';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

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

  // Latest view kept in a ref so the fetch callback always serializes the
  // current view without being part of the effect dependency array.
  const viewRef = useRef(view);
  viewRef.current = view;

  const runSummary = useCallback(async () => {
    // Abort any previous in-flight request before starting a new one.
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    const key = JSON.stringify(viewRef.current.spec);

    dispatch({ type: 'START' });

    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(viewRef.current),
        signal: ac.signal,
      });

      if (!res.ok) {
        let message: string;
        if (res.status === 429) {
          message = 'The AI is busy right now — try again in a minute.';
        } else if (res.status === 503) {
          try {
            const data = (await res.json()) as { error?: string };
            message = data.error ?? 'AI summary is not configured.';
          } catch {
            message = 'AI summary is not configured.';
          }
        } else {
          try {
            const data = (await res.json()) as { error?: string };
            message = data.error ?? 'Could not generate summary.';
          } catch {
            message = 'Could not generate summary.';
          }
        }
        dispatch({ type: 'ERROR', message });
        return;
      }

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
    } catch {
      if (ac.signal.aborted) return;
      dispatch({
        type: 'ERROR',
        message:
          'Could not reach the summary service. Check your connection and try again.',
      });
    }
  }, []);

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
    <Card>
      <CardHeader>
        <CardTitle>AI summary</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="text-muted-foreground text-sm">
            No spending data to summarize for this period.
          </p>
        ) : state.phase === 'idle' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground text-sm">
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
