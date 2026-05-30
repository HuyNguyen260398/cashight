'use client';

import { useEffect, useState } from 'react';
import type { Statement } from '@/lib/schemas';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function AiSummaryCard({ statement }: { statement: Statement }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Key the effect on stable primitive identifiers so that a new object
  // reference with identical data (e.g. after a server-component re-render)
  // does not cancel and restart the in-progress stream.
  const { cardLast4, statementDate } = statement;

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

        if (!res.body) {
          setError('Could not generate summary');
          return;
        }

        const reader = res.body.getReader();
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
    // statement object is captured at effect-creation time; re-keying on
    // cardLast4 + statementDate (primitives) prevents spurious re-fetches
    // when the parent re-renders with a new reference to identical data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardLast4, statementDate]);

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
        ) : summary ? (
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">
            {summary}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No summary available.</p>
        )}
      </CardContent>
    </Card>
  );
}
