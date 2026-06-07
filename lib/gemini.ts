import 'server-only';

/**
 * Thin streaming wrapper around the Gemini API.
 *
 * The GoogleGenAI client is lazy-initialised inside the function so that a
 * missing GEMINI_API_KEY only errors when the function is actually called,
 * not at import time (the route that imports this module must still be able
 * to load even when no key is configured in dev).
 */

import { GoogleGenAI } from '@google/genai';

export async function* streamSummary(
  prompt: string,
  apiKey: string | undefined,
): AsyncGenerator<string> {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  for await (const chunk of response) {
    yield chunk.text ?? '';
  }
}
