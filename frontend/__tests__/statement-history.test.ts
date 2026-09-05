import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client';
import { loadStatementHistory, statementRows } from '../lib/statement-history';
import type { StatementListItem } from '../api/contracts';

vi.mock('../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../auth/config', () => ({ getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.test' }) }));

const tpb: StatementListItem = {
  statementId: '2026-07-1111', bank: 'TPBank', cardLast4: '1111',
  statementDate: '2026-07-01', totalSpend: 100, transactionCount: 1,
  uploadedAt: '2026-08-01T00:00:00.000Z',
};
const vib: StatementListItem = { ...tpb, statementId: '2026-07-2222', bank: 'VIB', cardLast4: '2222' };
beforeEach(() => vi.resetAllMocks());

describe('complete bank statement history', () => {
  it('finds a bank after opposite-bank and empty cursor pages and deduplicates IDs', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(Response.json({ items: [tpb], nextCursor: 'second' }))
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: 'third' }))
      .mockResolvedValueOnce(Response.json({ items: [vib, tpb], nextCursor: null }));
    const items = await loadStatementHistory();
    expect(items).toHaveLength(2);
    expect(statementRows(items, 'VIB')).toEqual([{
      key: '2026-07-2222', bank: 'VIB', cardLast4: '2222', year: 2026, month: 7,
      totalSpend: 100, uploadedAt: '2026-08-01T00:00:00.000Z',
    }]);
    expect(statementRows(items, 'TPBank').map((row) => row.key)).toEqual(['2026-07-1111']);
    expect(apiFetch).toHaveBeenNthCalledWith(3, 'https://api.example.test/statements?cursor=third', expect.any(Object));
  });
  it('normalizes legacy records to TPBank', async () => {
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ items: [{ ...tpb, bank: undefined }], nextCursor: null }));
    const items = await loadStatementHistory();
    expect(statementRows(items, 'TPBank')).toHaveLength(1);
    expect(statementRows(items, 'VIB')).toEqual([]);
  });
  it('rejects repeated cursors instead of silently truncating', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => Response.json({ items: [], nextCursor: 'same' }));
    await expect(loadStatementHistory()).rejects.toThrow(/cursor/i);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
  it('does not publish partial results if a later page fails', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ items: [tpb], nextCursor: 'second' }))
      .mockRejectedValueOnce(new Error('offline'));
    await expect(loadStatementHistory()).rejects.toThrow('offline');
  });
  it('rejects invalid metadata', async () => {
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ items: [{ ...tpb, bank: 'unknown' }], nextCursor: null }));
    await expect(loadStatementHistory()).rejects.toThrow();
  });
  it('does not fetch with an already cancelled signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadStatementHistory(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
