import { describe, expect, it } from 'vitest';

import {
  groupItemsIntoRows,
  rowText,
  type RawTextItem,
} from '@cashight/domain/parsers/pdf-layout';

const items: RawTextItem[] = [
  // Deliberately out of reading order, the way VIB emits them.
  { text: '124,000,000.00', x: 220, y: 624 },
  { text: 'Sao kê giao dịch thẻ tín dụng VIB', x: 30, y: 801 },
  { text: '(Credit Limit)', x: 101, y: 624 },
  { text: 'Hạn mức tín dụng', x: 30, y: 625 },
  { text: '   ', x: 400, y: 624 },
];

describe('groupItemsIntoRows', () => {
  it('sorts rows top-to-bottom by descending y', () => {
    const rows = groupItemsIntoRows(items);
    expect(rows[0].cells[0].text).toBe('Sao kê giao dịch thẻ tín dụng VIB');
  });

  it('groups items within the y tolerance into one row, ordered by x', () => {
    const rows = groupItemsIntoRows(items);
    expect(rows[1].cells.map((c) => c.text)).toEqual([
      'Hạn mức tín dụng',
      '(Credit Limit)',
      '124,000,000.00',
    ]);
  });

  it('drops whitespace-only items', () => {
    const rows = groupItemsIntoRows(items);
    expect(rows.flatMap((r) => r.cells).some((c) => c.text.trim() === '')).toBe(
      false,
    );
  });

  it('keeps items further apart than the tolerance in separate rows', () => {
    const rows = groupItemsIntoRows(
      [
        { text: 'a', x: 10, y: 100 },
        { text: 'b', x: 20, y: 90 },
      ],
      2,
    );
    expect(rows).toHaveLength(2);
  });
});

describe('rowText', () => {
  it('joins a row into a single space-separated string', () => {
    const rows = groupItemsIntoRows(items);
    expect(rowText(rows[1])).toBe('Hạn mức tín dụng (Credit Limit) 124,000,000.00');
  });
});
