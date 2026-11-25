'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { YearMonth } from '@cashight/domain/aws-invoices';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { ApiRequestError, apiFetch } from '@/frontend/api/client';
import { getPublicConfig } from '@/frontend/auth/config';

type SummaryState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; text: string }
  | { phase: 'error'; message: string };

type SummaryAction =
  | { type: 'RESET' }
  | { type: 'LOAD' }
  | { type: 'DONE'; text: string }
  | { type: 'ERROR'; message: string };

function reducer(_: SummaryState, action: SummaryAction): SummaryState {
  switch (action.type) {
    case 'RESET':
      return { phase: 'idle' };
    case 'LOAD':
      return { phase: 'loading' };
    case 'DONE':
      return { phase: 'done', text: action.text };
    case 'ERROR':
      return { phase: 'error', message: action.message };
  }
}

function summaryError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return 'The AI service is busy. Try again in a minute.';
    }
    if (error.status === 503) {
      return 'The AI summary service is unavailable right now.';
    }
    return 'The AI summary could not be generated.';
  }
  return 'Could not reach the AI summary service. Check your connection and try again.';
}

export function AwsInvoiceAiSummary({ yearMonth }: { yearMonth: YearMonth }) {
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' });
  const cacheRef = useRef(new Map<YearMonth, string>());
  const controllerRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: 'LOAD' });

    try {
      const { apiBaseUrl } = getPublicConfig();
      const response = await apiFetch(`${apiBaseUrl}/aws/invoices/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearMonth }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (controller.signal.aborted) return;
      if (!text.trim()) throw new Error('Empty summary response');
      cacheRef.current.set(yearMonth, text);
      dispatch({ type: 'DONE', text });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      dispatch({ type: 'ERROR', message: summaryError(error) });
    }
  }, [yearMonth]);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const cached = cacheRef.current.get(yearMonth);
    dispatch(cached ? { type: 'DONE', text: cached } : { type: 'RESET' });
  }, [yearMonth]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return (
    <Container
      fitHeight
      header={
        <Header variant="h2" description="Generated from totals, top services, masked allocations, and trend data only.">
          AI invoice summary
        </Header>
      }
    >
      <div aria-live="polite">
        {state.phase === 'idle' ? (
          <SpaceBetween size="s">
            <Box color="text-body-secondary">Ask Gemini for a concise aggregate overview of this month.</Box>
            <Button variant="primary" iconName="gen-ai" onClick={() => void generate()}>
              Generate AI summary
            </Button>
          </SpaceBetween>
        ) : state.phase === 'loading' ? (
          <div role="status" aria-label="Generating AI summary">
            <StatusIndicator type="loading">Generating aggregate insight…</StatusIndicator>
          </div>
        ) : state.phase === 'error' ? (
          <SpaceBetween size="s">
            <div role="alert">
              <StatusIndicator type="error">{state.message}</StatusIndicator>
            </div>
            <Button onClick={() => void generate()}>Try again</Button>
          </SpaceBetween>
        ) : (
          <SpaceBetween size="m">
            <div style={{ whiteSpace: 'pre-wrap' }}>{state.text}</div>
            <Button variant="inline-link" iconName="refresh" onClick={() => void generate()}>
              Regenerate
            </Button>
          </SpaceBetween>
        )}
      </div>
    </Container>
  );
}
