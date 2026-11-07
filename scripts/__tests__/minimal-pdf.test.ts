import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { extractPdfText } from '@cashight/domain/parsers/pdf-text';

import { writeMinimalPdf } from '../fixtures/minimal-pdf.mjs';

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('writeMinimalPdf', () => {
  it('writes a PDF that extractPdfText reads', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'minimal-pdf-'));
    const file = path.join(dir, 'smoke.pdf');

    await writeMinimalPdf(file);
    const { text } = await extractPdfText(readFileSync(file));

    expect(text).toContain('CASHIGHT SMOKE');
  });
});
