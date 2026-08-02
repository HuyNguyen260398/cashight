/**
 * Coordinate-based text extraction: reconstructs a PDF page as rows of cells
 * using each text item's x/y position.
 *
 * `pdf-parse` groups lines by the vertical distance between *consecutive* text
 * items in content-stream order. That works for a single-column statement like
 * TPBank's, but a two-column layout (VIB) emits items out of reading order and
 * the grouping falls apart. Sorting by absolute position instead is immune to
 * emission order.
 *
 * Pure geometry — this module knows nothing about any particular bank.
 */

// MUST precede the pdfjs-dist import: pdfjs references `DOMMatrix` while its
// module body evaluates. See ../pdf-dom-polyfill.ts.
import '../pdf-dom-polyfill';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface RawTextItem {
  text: string;
  x: number;
  y: number;
}

export interface LayoutCell {
  x: number;
  text: string;
}

export interface LayoutRow {
  y: number;
  cells: LayoutCell[];
}

export interface LayoutPage {
  pageNumber: number;
  rows: LayoutRow[];
}

/** Items whose y differs by no more than this belong to the same visual row. */
const DEFAULT_Y_TOLERANCE = 2;

/**
 * Bucket text items into visual rows: same row when their y values are within
 * `yTolerance`. Rows are returned top-to-bottom (descending y, PDF origin is
 * bottom-left) and each row's cells left-to-right.
 */
export function groupItemsIntoRows(
  items: RawTextItem[],
  yTolerance: number = DEFAULT_Y_TOLERANCE,
): LayoutRow[] {
  const rows: LayoutRow[] = [];

  for (const item of items) {
    if (item.text.trim() === '') continue;
    const row = rows.find((r) => Math.abs(r.y - item.y) <= yTolerance);
    if (row) {
      row.cells.push({ x: item.x, text: item.text.trim() });
    } else {
      rows.push({ y: item.y, cells: [{ x: item.x, text: item.text.trim() }] });
    }
  }

  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
  }
  return rows;
}

/** Flatten a row into one space-separated string. */
export function rowText(row: LayoutRow): string {
  return row.cells.map((c) => c.text).join(' ');
}

/**
 * Extract every page of a PDF as positioned rows.
 *
 * A fresh Uint8Array is allocated per call because pdf.js transfers the typed
 * array to its worker and detaches it. The document is always destroyed.
 */
export async function extractPdfLayout(
  buffer: Buffer,
  password?: string,
): Promise<LayoutPage[]> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    password,
    isEvalSupported: false,
  });
  const doc = await task.promise;

  try {
    const pages: LayoutPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: RawTextItem[] = [];
      for (const item of content.items) {
        const textItem = item as { str?: string; transform?: number[] };
        if (typeof textItem.str !== 'string' || !textItem.transform) continue;
        items.push({
          text: textItem.str,
          x: Math.round(textItem.transform[4]),
          y: Math.round(textItem.transform[5]),
        });
      }
      pages.push({ pageNumber, rows: groupItemsIntoRows(items) });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
