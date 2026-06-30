import { GoogleGenAI } from '@google/genai';

export async function* streamSummary(
  prompt: string,
  apiKey: string,
): AsyncGenerator<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });
  for await (const chunk of response) {
    yield chunk.text ?? '';
  }
}
