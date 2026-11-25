'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AggregatedView } from '@/lib/aggregations';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
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
      const config = getPublicConfig();
      const res = await apiFetch(`${config.apiBaseUrl}/summaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(view),
        signal: ac.signal,
      });

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
          const body = err.body as { error?: { message?: string } } | null;
          message = body?.error?.message ?? 'AI summary is not configured.';
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

  const summaryText = (text: string) => <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;

  return (
    <Container
      fitHeight
      header={
        <Header variant="h2" description="Privacy-preserving aggregate insight.">
          AI summary
        </Header>
      }
    >
      {isEmpty ? (
        <Box color="text-body-secondary">No spending data to summarize for this period.</Box>
      ) : state.phase === 'idle' ? (
        <SpaceBetween size="s">
          <Box color="text-body-secondary">Generate an AI overview of {view.label} spending.</Box>
          <Button variant="primary" iconName="gen-ai" onClick={() => void runSummary()}>
            Summarize expenses with AI
          </Button>
        </SpaceBetween>
      ) : state.phase === 'loading' ? (
        state.text ? (
          summaryText(state.text)
        ) : (
          <StatusIndicator type="loading">Generating summary…</StatusIndicator>
        )
      ) : state.phase === 'error' ? (
        <SpaceBetween size="s">
          <StatusIndicator type="error">{state.message}</StatusIndicator>
          <Button onClick={() => void runSummary()}>Try again</Button>
        </SpaceBetween>
      ) : (
        <SpaceBetween size="m">
          {summaryText(state.text)}
          <Button variant="inline-link" iconName="refresh" onClick={() => void runSummary()}>
            Regenerate
          </Button>
        </SpaceBetween>
      )}
    </Container>
  );
}
