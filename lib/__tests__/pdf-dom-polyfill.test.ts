import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { installPdfDomPolyfills } from '@cashight/domain/pdf-dom-polyfill';

describe('pdf DOM polyfill', () => {
  it('installs the globals pdfjs-dist needs under Node', () => {
    installPdfDomPolyfills();
    expect(typeof (globalThis as Record<string, unknown>).DOMMatrix).toBe('function');
    expect(typeof (globalThis as Record<string, unknown>).ImageData).toBe('function');
    expect(typeof (globalThis as Record<string, unknown>).Path2D).toBe('function');
  });

  it('constructs a DOMMatrix from a 6-value affine array', () => {
    const DOMMatrix = (globalThis as Record<string, unknown>).DOMMatrix as new (
      init?: number[],
    ) => { a: number; b: number; c: number; d: number; e: number; f: number };
    const m = new DOMMatrix([2, 0, 0, 3, 10, 20]);
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([2, 0, 0, 3, 10, 20]);
  });

  it('inverts an affine matrix correctly (invertSelf round-trips)', () => {
    const DOMMatrix = (globalThis as Record<string, unknown>).DOMMatrix as new (
      init?: number[],
    ) => {
      a: number;
      d: number;
      e: number;
      f: number;
      invertSelf: () => { a: number; d: number; e: number; f: number };
    };
    const inv = new DOMMatrix([2, 0, 0, 4, 6, 8]).invertSelf();
    // inverse of scale(2,4)+translate is scale(1/2,1/4) with translated origin.
    expect(inv.a).toBeCloseTo(0.5);
    expect(inv.d).toBeCloseTo(0.25);
    expect(inv.e).toBeCloseTo(-3);
    expect(inv.f).toBeCloseTo(-2);
  });

  it('parser imports the polyfill before pdf-parse so globals exist at eval time', () => {
    const src = readFileSync(
      fileURLToPath(
        new URL('../../packages/domain/src/parsers/tpbank.ts', import.meta.url),
      ),
      'utf8',
    );
    const polyfillIdx = src.indexOf("pdf-dom-polyfill");
    const pdfParseIdx = src.indexOf("from 'pdf-parse'");
    expect(polyfillIdx).toBeGreaterThanOrEqual(0);
    expect(pdfParseIdx).toBeGreaterThan(polyfillIdx);
  });
});
