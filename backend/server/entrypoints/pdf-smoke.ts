/**
 * In-image PDF smoke test (CI only; never a workload). Runs the parser
 * worker's PDF text extraction on a file and prints a summary, never the
 * text itself. Bundled next to parser-worker/pdf.worker.mjs so it exercises
 * the same pdfjs worker resolution and DOM polyfill as the real worker.
 *
 * Usage: node /app/parser-worker/pdf-smoke.js <pdf-file>
 * Exits 0 only when the text contains "CASHIGHT SMOKE"
 * (scripts/fixtures/minimal-pdf.mjs writes such a file).
 */
// pdf-text imports the DOM polyfill before pdf-parse (see CLAUDE.md).
import { readFile } from 'node:fs/promises';

import { extractPdfText } from '@cashight/domain/parsers/pdf-text';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('usage: pdf-smoke.js <pdf-file>');
  const { text } = await extractPdfText(await readFile(file));
  const hasSmokeText = text.includes('CASHIGHT SMOKE');
  console.log(JSON.stringify({ chars: text.length, hasSmokeText }));
  process.exit(hasSmokeText ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : 'unknown');
  process.exit(1);
});
