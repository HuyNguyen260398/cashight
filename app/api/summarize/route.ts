export const runtime = 'nodejs';
export const maxDuration = 30;

import { StatementSchema } from '@/lib/schemas';
import { buildSummaryPayload } from '@/lib/summary-payload';
import { streamSummary } from '@/lib/gemini';

const SYSTEM_PROMPT = `You are a personal finance assistant. Given an anonymized monthly spending summary, write a concise overview (3-4 short paragraphs) covering:

1. Overall spending level and biggest categories
2. Notable patterns or recurring expenses
3. Any fees or charges worth being aware of
4. One actionable suggestion for next month

Write in the same language as the merchant names suggest the user uses (likely Vietnamese or English). Be warm and non-judgmental. Format amounts in VND with thousand separators. Do NOT invent numbers — only use what is in the data provided.`;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = StatementSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid statement' }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: 'AI summary is not configured (GEMINI_API_KEY missing).' },
      { status: 503 },
    );
  }

  const payload = buildSummaryPayload(parsed.data);

  const prompt = `${SYSTEM_PROMPT}\n\nData:\n${JSON.stringify(payload, null, 2)}`;

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
