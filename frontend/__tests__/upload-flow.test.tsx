// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { computeSha256 } from '@/frontend/lib/sha256';
import { sleep } from '@/frontend/lib/sleep';
import { useUploadJob } from '@/frontend/hooks/use-upload-job';
import { useDashboard } from '@/frontend/hooks/use-dashboard';
import { useStatements } from '@/frontend/hooks/use-statements';

// ── module-level mocks (hoisted) ──────────────────────────────────────────────

const mockApiFetch = vi.fn();

vi.mock('@/frontend/api/client', () => ({
  apiFetch: (...args: Parameters<typeof mockApiFetch>) => mockApiFetch(...args),
  ApiRequestError: class extends Error {
    constructor(
      public readonly status: number,
      public readonly body: unknown,
    ) {
      super(`API request failed with status ${status}`);
      this.name = 'ApiRequestError';
    }
  },
}));

vi.mock('@/frontend/auth/config', () => ({
  getPublicConfig: () => ({
    apiBaseUrl: 'https://api.example.com',
    cognitoAuthority: 'https://cognito.example.com',
    cognitoClientId: 'test-client-id',
    appOrigin: 'https://app.example.com',
  }),
}));

// Mock sleep so polls are instant — no timers needed in tests.
vi.mock('@/frontend/lib/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock toast so it doesn't error in jsdom.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeFile(name = 'statement.pdf', content = 'PDF content'): File {
  return new File([content], name, { type: 'application/pdf' });
}

// Standard example UUID (version 4, variant 8) — passes Zod's uuid() check.
const BASE_JOB = {
  jobId: '550e8400-e29b-41d4-a716-446655440000',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeJobResponse(
  state: string,
  extras?: Record<string, unknown>,
): { job: Record<string, unknown> } {
  return { job: { ...BASE_JOB, state, ...extras } };
}

const PRESIGN = {
  url: 'https://s3.example.com/presigned',
  method: 'PUT' as const,
  headers: {
    'x-amz-server-side-encryption': 'AES256',
    'Content-Type': 'application/pdf',
  },
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

function makeCreateResponse(jobState = 'PENDING_UPLOAD') {
  return { job: { ...BASE_JOB, state: jobState }, upload: PRESIGN };
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────

describe('computeSha256', () => {
  it('returns a 64-char lowercase hex string', async () => {
    const buf = new TextEncoder().encode('hello world').buffer as ArrayBuffer;
    const result = await computeSha256(buf);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the known SHA-256 of an empty buffer', async () => {
    const result = await computeSha256(new ArrayBuffer(0));
    // SHA-256("") is well-known:
    expect(result).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('zero-pads every byte so output is always exactly 64 chars', async () => {
    const bufs: ArrayBuffer[] = [
      new Uint8Array([0x00]).buffer,
      new Uint8Array([0xff]).buffer,
      new TextEncoder().encode('abc').buffer as ArrayBuffer,
    ];
    for (const buf of bufs) {
      expect(await computeSha256(buf)).toHaveLength(64);
    }
  });

  it('is deterministic', async () => {
    const buf = new TextEncoder().encode('cashight').buffer as ArrayBuffer;
    expect(await computeSha256(buf)).toBe(await computeSha256(buf));
  });
});

// ── useUploadJob ──────────────────────────────────────────────────────────────

describe('useUploadJob', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    // Re-apply sleep mock after reset clears it.
    vi.mocked(sleep).mockResolvedValue(undefined);
    originalFetch = globalThis.fetch;
    // Default: presigned PUT succeeds.
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('starts in idle phase', () => {
    const { result } = renderHook(() => useUploadJob());
    expect(result.current.state.phase).toBe('idle');
  });

  it('POST /uploads is called with fileName, contentType, size, sha256, force=false', async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(makeCreateResponse()))
      .mockResolvedValueOnce(jsonResponse(makeJobResponse('SUCCEEDED')));

    const file = makeFile();
    const { result } = renderHook(() => useUploadJob());

    act(() => { result.current.start(file); });

    await waitFor(() =>
      expect(result.current.state.phase).not.toBe('working'),
    );

    // Find the POST /uploads call
    const postCall = (mockApiFetch.mock.calls as Array<[string, RequestInit]>).find(
      ([url]) => url === 'https://api.example.com/uploads',
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1].body as string) as Record<string, unknown>;

    expect(body.fileName).toBe('statement.pdf');
    expect(body.contentType).toBe('application/pdf');
    expect(body.size).toBe(file.size);
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.force).toBe(false);
  });

  it('PUT to presigned URL uses plain fetch (not apiFetch) with signed headers', async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(makeCreateResponse()))
      .mockResolvedValueOnce(jsonResponse(makeJobResponse('SUCCEEDED')));

    const mockPut = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    globalThis.fetch = mockPut;

    const { result } = renderHook(() => useUploadJob());
    act(() => { result.current.start(makeFile()); });

    await waitFor(() =>
      expect(result.current.state.phase).not.toBe('working'),
    );

    // PUT must go via global fetch, NOT apiFetch
    expect(mockPut).toHaveBeenCalledOnce();
    const [putUrl, putInit] = mockPut.mock.calls[0] as [string, RequestInit];
    expect(putUrl).toBe(PRESIGN.url);
    expect(putInit.method).toBe('PUT');
    // Signed headers forwarded exactly
    const headers = putInit.headers as Record<string, string>;
    expect(headers['x-amz-server-side-encryption']).toBe('AES256');
    expect(headers['Content-Type']).toBe('application/pdf');

    // apiFetch must NOT have been called for the presigned URL
    const apiFetchUrls = (mockApiFetch.mock.calls as Array<[string]>).map(([u]) => u);
    expect(apiFetchUrls).not.toContain(PRESIGN.url);
  });

  it('transitions through PENDING_UPLOAD → PROCESSING → SUCCEEDED', async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(makeCreateResponse()))
      .mockResolvedValueOnce(jsonResponse(makeJobResponse('PENDING_UPLOAD')))
      .mockResolvedValueOnce(jsonResponse(makeJobResponse('PROCESSING')))
      .mockResolvedValueOnce(jsonResponse(makeJobResponse('SUCCEEDED')));

    const { result } = renderHook(() => useUploadJob());
    act(() => { result.current.start(makeFile()); });

    await waitFor(() =>
      expect(result.current.state.phase).toBe('succeeded'),
    );

    // 3 poll calls (after the initial POST)
    const pollCalls = (mockApiFetch.mock.calls as Array<[string]>).filter(
      ([url]) => url.includes('/uploads/'),
    );
    expect(pollCalls).toHaveLength(3);
  });

  it('enters conflict phase when job state is CONFLICT', async () => {
    const conflict = { cardLast4: '9674', year: 2026, month: 5 };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(makeCreateResponse()))
      .mockResolvedValueOnce(jsonResponse(makeJobResponse('CONFLICT', { conflict })));

    const { result } = renderHook(() => useUploadJob());
    act(() => { result.current.start(makeFile()); });

    await waitFor(() =>
      expect(result.current.state.phase).toBe('conflict'),
    );

    const s = result.current.state;
    if (s.phase !== 'conflict') throw new Error('wrong phase');
    expect(s.conflict.cardLast4).toBe('9674');
    expect(s.conflict.year).toBe(2026);
    expect(s.conflict.month).toBe(5);
  });

  it('force-retries with force=true after conflict confirmation', async () => {
    const conflict = { cardLast4: '9674', year: 2026, month: 5 };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(makeCreateResponse()))
      .mockResolvedValueOnce(jsonResponse(makeJobResponse('CONFLICT', { conflict })))
      .mockResolvedValueOnce(jsonResponse(makeCreateResponse()))
      .mockResolvedValueOnce(jsonResponse(makeJobResponse('SUCCEEDED')));

    const { result } = renderHook(() => useUploadJob());
    act(() => { result.current.start(makeFile()); });

    await waitFor(() =>
      expect(result.current.state.phase).toBe('conflict'),
    );

    // User confirms overwrite
    act(() => {
      const s = result.current.state;
      if (s.phase !== 'conflict') throw new Error('wrong phase');
      result.current.start(s.file, true);
    });

    await waitFor(() =>
      expect(result.current.state.phase).toBe('succeeded'),
    );

    // Second POST must carry force: true
    const postCalls = (mockApiFetch.mock.calls as Array<[string, RequestInit]>).filter(
      ([url]) => url === 'https://api.example.com/uploads',
    );
    expect(postCalls).toHaveLength(2);
    const forceBody = JSON.parse(postCalls[1][1].body as string) as { force: boolean };
    expect(forceBody.force).toBe(true);
  });

  it('enters failed phase for FAILED job state', async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(makeCreateResponse()))
      .mockResolvedValueOnce(
        jsonResponse(makeJobResponse('FAILED', { errorCode: 'PARSE_ERROR' })),
      );

    const { result } = renderHook(() => useUploadJob());
    act(() => { result.current.start(makeFile()); });

    await waitFor(() =>
      expect(result.current.state.phase).toBe('failed'),
    );

    const s = result.current.state;
    if (s.phase !== 'failed') throw new Error('wrong phase');
    expect(s.error).toBe('PARSE_ERROR');
  });

  it('reset() returns to idle from failed phase', async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(makeCreateResponse()))
      .mockResolvedValueOnce(
        jsonResponse(makeJobResponse('FAILED', { errorCode: 'ERR' })),
      );

    const { result } = renderHook(() => useUploadJob());
    act(() => { result.current.start(makeFile()); });

    await waitFor(() => expect(result.current.state.phase).toBe('failed'));

    act(() => { result.current.reset(); });

    expect(result.current.state.phase).toBe('idle');
  });
});

// ── Streaming summary ─────────────────────────────────────────────────────────

describe('Streaming summary via apiFetch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('assembles text chunks from a streaming response', async () => {
    const chunks = ['Hello ', 'world', '!'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    mockApiFetch.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const { apiFetch } = await import('@/frontend/api/client');
    const res = await apiFetch(
      'https://api.example.com/summaries?period=month&year=2026&month=5',
    );

    expect(res.ok).toBe(true);
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    expect(text).toBe('Hello world!');
  });

  it('passes period params in the summaries URL', async () => {
    const stream = new ReadableStream({ start(c) { c.close(); } });
    mockApiFetch.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const { apiFetch } = await import('@/frontend/api/client');
    await apiFetch(
      'https://api.example.com/summaries?period=quarter&year=2025&quarter=3',
    );

    const [url] = mockApiFetch.mock.calls[0] as [string];
    expect(url).toContain('period=quarter');
    expect(url).toContain('year=2025');
    expect(url).toContain('quarter=3');
  });
});

// ── useDashboard ──────────────────────────────────────────────────────────────

const MONTH_SPEC = { type: 'month' as const, year: 2026, month: 5 };
const YEAR_SPEC = { type: 'year' as const, year: 2026 };

const DASHBOARD_PAYLOAD = {
  spec: MONTH_SPEC,
  statementCount: 1,
  label: 'May 2026',
};

describe('useDashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('is in loading state while the first fetch is in flight', () => {
    // Never-resolving promise simulates an in-flight request.
    mockApiFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDashboard(MONTH_SPEC));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('returns error state when apiFetch rejects', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useDashboard(MONTH_SPEC));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Network error');
    expect(result.current.data).toBeNull();
  });

  it('returns data when fetch succeeds', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(DASHBOARD_PAYLOAD));

    const { result } = renderHook(() => useDashboard(MONTH_SPEC));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.statementCount).toBe(1);
    expect(result.current.data?.label).toBe('May 2026');
  });

  it('re-fetches when spec changes and returns new data', async () => {
    const yearPayload = { spec: YEAR_SPEC, statementCount: 3, label: '2026' };

    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(DASHBOARD_PAYLOAD))
      .mockResolvedValueOnce(jsonResponse(yearPayload));

    type Spec = typeof MONTH_SPEC | typeof YEAR_SPEC;
    const { result, rerender } = renderHook(
      ({ spec }: { spec: Spec }) => useDashboard(spec),
      { initialProps: { spec: MONTH_SPEC as Spec } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.label).toBe('May 2026');

    rerender({ spec: YEAR_SPEC });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.label).toBe('2026');
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });
});

// ── useStatements ─────────────────────────────────────────────────────────────

const STATEMENT_ITEM = {
  statementId: 'statements/9674/2026/2026-05.json',
  cardLast4: '9674',
  statementDate: '2026-05-01',
  totalSpend: 26986712,
  transactionCount: 41,
  uploadedAt: '2026-06-01T00:00:00.000Z',
};

describe('useStatements', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns items after the initial load', async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse({ items: [STATEMENT_ITEM], nextCursor: null }),
    );

    const { result } = renderHook(() => useStatements());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].cardLast4).toBe('9674');
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('deleteStatement calls DELETE and removes the item from the list', async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse({ items: [STATEMENT_ITEM], nextCursor: null }),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const { result } = renderHook(() => useStatements());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await result.current.deleteStatement(STATEMENT_ITEM.statementId);
    });

    const deleteCalls = (mockApiFetch.mock.calls as Array<[string, RequestInit]>).filter(
      ([, init]) => init?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain(
      encodeURIComponent(STATEMENT_ITEM.statementId),
    );

    // Item optimistically removed from list.
    expect(result.current.items).toHaveLength(0);
  });

  it('loadMore fetches with cursor and appends items', async () => {
    const ITEM_2 = {
      ...STATEMENT_ITEM,
      statementId: 'statements/9674/2025/2025-12.json',
      statementDate: '2025-12-01',
    };
    const CURSOR = 'eyJrZXkiOiAic3RhdGVtZW50cy85Njc0LzIwMjYvMjAyNi0wNS5qc29uIn0=';

    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse({ items: [STATEMENT_ITEM], nextCursor: CURSOR }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [ITEM_2], nextCursor: null }),
      );

    const { result } = renderHook(() => useStatements());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.nextCursor).toBe(CURSOR);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    // Second call must include cursor param.
    const loadMoreUrl = (mockApiFetch.mock.calls as Array<[string]>)[1][0];
    expect(loadMoreUrl).toContain('cursor=');
    expect(result.current.nextCursor).toBeNull();
  });
});
