'use client';

import { useEffect, useState } from 'react';
import type { Statement } from '@/lib/schemas';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function AiSummaryCard({ statement }: { statement: Statement }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    async function fetchSummary() {
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
          setError(message);
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          setSummary((s) => s + decoder.decode(value, { stream: true }));
        }
      } catch {
        if (!ac.signal.aborted) {
          setError('Could not generate summary');
        }
      } finally {
        setLoading(false);
      }
    }

    void fetchSummary();

    return () => {
      ac.abort();
    };
  }, [statement]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI summary</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && !summary ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[90%]" />
            <Skeleton className="h-4 w-[80%]" />
            <Skeleton className="h-4 w-[85%]" />
          </div>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">
            {summary}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
