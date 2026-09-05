// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBankStatements } from '../hooks/use-bank-statements';
import { apiFetch } from '../api/client';

vi.mock('../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../auth/config', () => ({ getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.test' }) }));
const item = {
  statementId: '2026-07-1111', bank: 'TPBank', cardLast4: '1111',
  statementDate: '2026-07-01', totalSpend: 100, transactionCount: 1,
  uploadedAt: '2026-08-01T00:00:00.000Z',
};
const response = (items = [item]) => Response.json({ items, nextCursor: null });
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it('retains a complete snapshot on refresh failure and can retry', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(response());
  const { result } = renderHook(useBankStatements);
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await expect(result.current.refresh()).rejects.toThrow('offline'); });
  expect(result.current.items).toHaveLength(1);
  expect(result.current.error).toBe('offline');
  vi.mocked(apiFetch).mockResolvedValueOnce(response([]));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.items).toEqual([]);
  expect(result.current.error).toBeNull();
});

it('ignores a slow older refresh after a newer refresh wins', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(response());
  const { result } = renderHook(useBankStatements);
  await waitFor(() => expect(result.current.loading).toBe(false));
  let finish!: (value: Response) => void;
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(response([]));
  let old!: Promise<unknown>;
  act(() => { old = result.current.refresh().catch(() => undefined); });
  await act(async () => { await result.current.refresh(); });
  await act(async () => { finish(response()); await old; });
  expect(result.current.items).toEqual([]);
});

it('retains a row when DELETE fails and cannot resurrect it from a stale load after success', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(response());
  const { result } = renderHook(useBankStatements);
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('denied'));
  await act(async () => { await expect(result.current.deleteStatement(item.statementId)).rejects.toThrow('denied'); });
  expect(result.current.items).toHaveLength(1);
  let finish!: (value: Response) => void;
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(Response.json({ deleted: true }));
  let old!: Promise<unknown>;
  act(() => { old = result.current.refresh().catch(() => undefined); });
  await act(async () => { await result.current.deleteStatement(item.statementId); });
  await act(async () => { finish(response()); await old; });
  expect(result.current.items).toEqual([]);
  expect(result.current.refreshing).toBe(false);
});

it('aborts requests on unmount', () => {
  vi.mocked(apiFetch).mockImplementation(() => new Promise(() => undefined));
  const { unmount } = renderHook(useBankStatements);
  const signal = vi.mocked(apiFetch).mock.calls[0][1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
});
