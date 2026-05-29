# Step 05 — AI Summary Integration

> Add the Gemini-powered natural-language summary that explains the user's spending in plain Vietnamese or English.

**Estimated effort:** 2 hours
**Prerequisites:** Step 04
**Phase:** 1 — MVP

---

## Goal

A summary card on the dashboard that streams an AI-generated paragraph explaining the month's spending patterns. Only anonymized aggregates are sent to Gemini — never raw transaction data, never the card number.

> **Milestone:** Phase 1 complete after this step.

## Tasks

### Get a Gemini API key

1. Sign in to [Google AI Studio](https://aistudio.google.com/)
2. Create a new API key in the API keys section
3. Add to `.env.local`:
   ```
   GEMINI_API_KEY=AIza...
   ```

### Gemini client wrapper (`lib/gemini.ts`)

```ts
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function* streamSummary(prompt: string) {
  const response = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  for await (const chunk of response) {
    yield chunk.text ?? '';
  }
}
```

### Anonymized payload builder (`lib/summary-payload.ts`)

Build the minimal aggregate payload — this is critical for privacy:

```ts
import type { Statement } from './schemas';
import { byCategory, topMerchants } from './dashboard-aggregations';

export interface SummaryPayload {
  period: { year: number; month: number };
  totals: {
    spend: number;
    fees: number;
    interest: number;
    cashback: number;
    installments: number;
  };
  topCategories: Array<{ category: string; amount: number; pct: number }>;
  topMerchants: Array<{ merchant: string; amount: number }>;
  internationalSpendPct: number;
  notableObservations?: string[];
}

export function buildSummaryPayload(s: Statement): SummaryPayload {
  // Build aggregates only — NO card number, NO individual transactions, NO name
  return {
    period: { year: s.period.year, month: s.period.month },
    totals: { /* ... */ },
    topCategories: byCategory(s).slice(0, 5).map(/* ... */),
    topMerchants: topMerchants(s, 5).map(/* ... */),
    internationalSpendPct: /* ... */,
  };
}
```

### Summary route (`app/api/summarize/route.ts`)

```ts
import { streamSummary } from '@/lib/gemini';
import { buildSummaryPayload } from '@/lib/summary-payload';
import { StatementSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a personal finance assistant. Given an
anonymized monthly spending summary, write a concise overview (3-4 short
paragraphs) covering:

1. Overall spending level and biggest categories
2. Notable patterns or recurring expenses
3. Any fees or charges worth being aware of
4. One actionable suggestion for next month

Write in the same language as the merchant names suggest the user uses
(likely Vietnamese or English). Be warm and non-judgmental. Format amounts
in VND with thousand separators. Do NOT invent numbers — only use what is
in the data provided.`;

export async function POST(request: Request) {
  const body = await request.json();
  const statement = StatementSchema.parse(body);
  const payload = buildSummaryPayload(statement);

  const prompt = `${SYSTEM_PROMPT}\n\nData:\n${JSON.stringify(payload, null, 2)}`;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamSummary(prompt)) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
```

### Summary card component (`app/components/ai-summary-card.tsx`)

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import type { Statement } from '@/lib/schemas';

export function AiSummaryCard({ statement }: { statement: Statement }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(statement),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error('Summary failed');

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          setSummary((s) => s + decoder.decode(value));
        }
      } catch (err) {
        if (!ac.signal.aborted) setError('Could not generate summary');
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [statement]);

  return (
    <Card className="p-6">
      <h2 className="text-lg font-medium mb-3">AI summary</h2>
      {loading && !summary && <SkeletonLines />}
      {error && <p className="text-destructive">{error}</p>}
      {summary && <div className="prose prose-sm whitespace-pre-wrap">{summary}</div>}
    </Card>
  );
}
```

### Wire into dashboard

Add `<AiSummaryCard statement={statement} />` to the top of the `<Dashboard>` component, above the KPI cards.

## Files affected

- `lib/gemini.ts` — **create**
- `lib/summary-payload.ts` — **create**
- `app/api/summarize/route.ts` — **create**
- `app/components/ai-summary-card.tsx` — **create**
- `app/components/dashboard.tsx` — modify (add summary card)
- `.env.local` — add `GEMINI_API_KEY`

## Acceptance criteria

- Upload sample PDF → AI summary streams in within 5 seconds
- Summary mentions the user's biggest categories correctly (likely E-commerce, Installments, or Retail given the sample)
- Summary references the cashback received
- The payload sent to Gemini contains NO card number, NO transaction descriptions with personal context, NO name
- Verify payload by adding a temporary `console.log(payload)` in the API route — should look like the `SummaryPayload` type
- Rate-limit errors from Gemini are caught and shown as an inline error, not a crash

## Notes & gotchas

- **Free tier is 15 RPM / 1500 RPD.** For personal use this is fine. If hit, the error message should be informative.
- **Streaming improves perceived latency** — Gemini takes 2-5 seconds total, but the user sees text appear progressively.
- **Do NOT send the full statement.** Even though the schema is typed, the `/api/summarize` route receives the full Statement from the client — strip it down with `buildSummaryPayload()` before constructing the prompt.
- **Language matching:** Gemini handles Vietnamese natively. The prompt nudges it to match the user's language without forcing it.
- **System prompt is in the user content** for Gemini (unlike OpenAI's separate `system` role). This is correct per the Gemini API conventions.
- **Cache the summary in component state** keyed by statement ID once Step 07 introduces persistence — re-running the AI on every dashboard view burns quota.

## Next step

[Step 06 — S3 infrastructure (Terraform)](./06-s3-infrastructure.md)

> 🎉 **Phase 1 complete.** You now have a working end-to-end MVP. The next phase adds persistence and multi-period views.
