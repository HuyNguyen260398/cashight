'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Statement } from '@/lib/schemas';
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
  | { type: 'RESET' };

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
    case 'RESET':
      return { phase: 'idle' };
    default:
      return state;
  }
}

export function AiSummaryCard({ statement }: { statement: Statement }) {
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' });

  // Key on stable primitives to detect statement identity changes.
  const { cardLast4, statementDate } = statement;

  // Holds the AbortController for any in-flight request so we can cancel on
  // statement change or unmount without re-creating the controller unnecessarily.
  const acRef = useRef<AbortController | null>(null);

  // Reset to idle whenever the statement identity changes, and abort any
  // in-flight request from the previous statement.
  useEffect(() => {
    acRef.current?.abort();
    acRef.current = null;
    dispatch({ type: 'RESET' });
    // Intentionally keyed only on primitive identifiers — object reference
    // churn from parent re-renders must not reset the card.
  }, [cardLast4, statementDate]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      acRef.current?.abort();
    };
  }, []);

  const runSummary = useCallback(async () => {
    // Abort any previous in-flight request before starting a new one.
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;

    dispatch({ type: 'START' });

    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(statement),
        signal: ac.signal,
      });

      if (!res.ok) {
        let message = 'Could not generate summary';
        try {
          const data = (await res.json()) as { error?: string };
          message = data.error ?? message;
        } catch {
          // ignore JSON parse error; use default message
        }
        dispatch({ type: 'ERROR', message });
        return;
      }

      if (!res.body) {
        dispatch({ type: 'ERROR', message: 'Could not generate summary' });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        dispatch({ type: 'APPEND', chunk: decoder.decode(value, { stream: true }) });
      }

      dispatch({ type: 'DONE' });
    } catch {
      if (!ac.signal.aborted) {
        dispatch({ type: 'ERROR', message: 'Could not generate summary' });
      }
    }
  // statement is captured at call time; the reset effect above ensures any
  // stale closure from a previous statement is never executed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardLast4, statementDate]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI summary</CardTitle>
      </CardHeader>
      <CardContent>
        {state.phase === 'idle' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground text-sm">
              Generate an AI overview of this month&apos;s spending.
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
