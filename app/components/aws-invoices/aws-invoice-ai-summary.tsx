'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { YearMonth } from '@cashight/domain/aws-invoices';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
    <Card className="h-full min-h-60 gap-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-brand-500" aria-hidden />
          <CardTitle>AI invoice summary</CardTitle>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Generated from totals, top services, masked allocations, and trend data only.
        </p>
      </CardHeader>
      <CardContent aria-live="polite">
        {state.phase === 'idle' ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
              Ask Gemini for a concise aggregate overview of this month.
            </p>
            <Button className="min-h-11" onClick={() => void generate()}>
              Generate AI summary
            </Button>
          </div>
        ) : state.phase === 'loading' ? (
          <div role="status" aria-label="Generating AI summary" className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">Generating aggregate insight…</p>
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-5/6 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
          </div>
        ) : state.phase === 'error' ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-error-700 dark:text-error-400">{state.message}</p>
            <Button variant="outline" className="min-h-11" onClick={() => void generate()}>Try again</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-gray-300">{state.text}</p>
            <Button variant="ghost" size="sm" className="min-h-11" onClick={() => void generate()}>Regenerate</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
