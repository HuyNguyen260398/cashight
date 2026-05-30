export const runtime = 'nodejs';
export const maxDuration = 30;

import { AggregatedViewSchema } from '@/lib/schemas';
import type { AggregatedView } from '@/lib/aggregations';
import { buildSummaryPayload, type SummaryPayload } from '@/lib/summary-payload';
import { streamSummary } from '@/lib/gemini';

const SYSTEM_PROMPT = `You are a personal finance assistant reviewing anonymized credit-card spending aggregates.

Write a concise overview (3-4 short paragraphs). Be warm and non-judgmental. Format amounts in VND with thousand separators. Do NOT invent numbers — only use what is in the data provided. Write in the same language as the merchant names suggest the user uses (likely Vietnamese or English).`;

/** Build the period-specific instructions appended after the system prompt. */
function periodInstructions(payload: SummaryPayload): string {
  const { periodLabel, statementCount, subPeriods, periodType } = payload;
  const intro = `You are reviewing ${periodLabel} spending. ${statementCount} statement(s) are aggregated here.`;

  switch (periodType) {
    case 'month':
      return `${intro}
Cover, for this month:
1. Overall spending level and biggest categories
2. Notable patterns or recurring expenses
3. Any fees, interest, or charges worth being aware of
4. One actionable suggestion for next month`;

    case 'quarter':
      return `${intro}
Focus on month-over-month trends across the ${subPeriods.length} months in this quarter (see subPeriods). Cover:
1. Total spending and how it moved month to month within the quarter
2. The dominant categories and any shift between them
3. Any fees, interest, or charges worth being aware of
4. One actionable suggestion for the next quarter`;

    case 'year':
      return `${intro}
Give a year-in-review. Use the ${subPeriods.length} sub-periods (months) to identify trends. Cover:
1. Total spending and the biggest spending months
2. Dominant categories and any category shifts over the year
3. Any fees, interest, or charges worth being aware of
4. One actionable suggestion for next year`;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = AggregatedViewSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid aggregated view' }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: 'AI summary is not configured (GEMINI_API_KEY missing).' },
      { status: 503 },
    );
  }

  // The validated value is field-for-field compatible with AggregatedView.
  const payload = buildSummaryPayload(parsed.data as AggregatedView);

  const prompt = `${SYSTEM_PROMPT}\n\n${periodInstructions(payload)}\n\nData:\n${JSON.stringify(payload, null, 2)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamSummary(prompt)) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        console.error(
          'Summary stream failed:',
          err instanceof Error ? err.message : err,
        );
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
