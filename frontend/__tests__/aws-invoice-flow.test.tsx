// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import { ApiRequestError } from '@/frontend/api/client';
import { useAwsInvoiceUpload } from '@/frontend/hooks/use-aws-invoice-upload';
import { useAwsInvoices } from '@/frontend/hooks/use-aws-invoices';
import { sleep } from '@/frontend/lib/sleep';

const mockApiFetch = vi.fn();

vi.mock('@/frontend/api/client', () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(public readonly status: number, public readonly body: unknown) {
      super(`API request failed with status ${status}`);
    }
  },
  apiFetch: (...args: Parameters<typeof mockApiFetch>) => mockApiFetch(...args),
}));

vi.mock('@/frontend/auth/config', () => ({
  getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.com' }),
}));

vi.mock('@/frontend/lib/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => cleanup());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const uploadedAt = '2026-08-03T12:00:00.000Z';
const jobBase = {
  jobId: '550e8400-e29b-41d4-a716-446655440000',
  documentType: 'AWS_INVOICE' as const,
  owner: { workspaceId: 'primary' as const },
  force: false,
  createdAt: uploadedAt,
  updatedAt: uploadedAt,
  expiresAt: 1_786_000_000,
};
const presign = {
  url: 'https://s3.example.com/invoice-presigned',
  method: 'PUT' as const,
  headers: { 'Content-Type': 'application/pdf' },
  expiresAt: '2026-08-03T12:05:00.000Z',
};

const invoice = {
  seller: 'Amazon Web Services, Inc.' as const,
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD' as const,
  totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
  services: [
    { name: 'Example Service', charges: 100, tax: 10, total: 110 },
  ],
  linkedAccounts: [
    {
      accountLast4: '1234',
      charges: 100,
      credits: 0,
      tax: 10,
      total: 110,
      services: [
        { name: 'Example Service', charges: 100, tax: 10, total: 110 },
      ],
    },
  ],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: 'a'.repeat(64),
    uploadedAt,
  },
};

const historyItem = {
  yearMonth: '2026-07',
  currency: 'USD' as const,
  amountDue: 110,
  tax: 10,
  serviceCount: 1,
  linkedAccountCount: 1,
  uploadedAt,
};

const dashboard = {
  selected: invoice,
  yearMonth: '2026-07',
  kpis: {
    amountDue: 110,
    serviceCharges: 100,
    credits: 0,
    tax: 10,
    linkedAccountCount: 1,
    billedServiceCount: 1,
  },
  serviceBreakdown: [
    { name: 'Example Service', value: 110, percentage: 100 },
  ],
  topServices: [{ name: 'Example Service', value: 110, percentage: 100 }],
  chargeComposition: [
    { name: 'Charges' as const, value: 100 },
    { name: 'Credits' as const, value: 0 },
    { name: 'Tax' as const, value: 10 },
  ],
  accountAllocations: [
    { accountLast4: '1234', value: 110, percentage: 100 },
  ],
  monthlyTrend: [{ yearMonth: '2026-07', value: 110 }],
  serviceDetails: [
    { name: 'Example Service', charges: 100, tax: 10, total: 110 },
  ],
};

function queueSuccessfulLoads(): void {
  mockApiFetch
    .mockResolvedValueOnce(jsonResponse({ invoice }))
    .mockResolvedValueOnce(jsonResponse({ dashboard }))
    .mockResolvedValueOnce(
      jsonResponse({ items: [historyItem], nextCursor: null }),
    );
}

describe('useAwsInvoiceUpload', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(sleep).mockResolvedValue(undefined);
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses invoice endpoints and reports a month-only conflict', async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse({ job: { ...jobBase, state: 'PENDING_UPLOAD' }, upload: presign }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            ...jobBase,
            state: 'CONFLICT',
            errorCode: 'INVOICE_CONFLICT',
            conflict: { year: 2026, month: 7 },
          },
        }),
      );

    const { result } = renderHook(() => useAwsInvoiceUpload());
    act(() => result.current.start(new File(['pdf'], 'invoice.pdf')));

    await waitFor(() => expect(result.current.state.phase).toBe('conflict'));
    expect(mockApiFetch.mock.calls[0][0]).toBe(
      'https://api.example.com/aws/invoices/uploads',
    );
    expect(mockApiFetch.mock.calls[1][0]).toBe(
      `https://api.example.com/aws/invoices/uploads/${jobBase.jobId}`,
    );
    expect(result.current.state).toMatchObject({
      conflict: { year: 2026, month: 7 },
    });
    expect(JSON.stringify(result.current.state)).not.toContain('cardLast4');
  });

  it('maps invoice failures and uses the invoice success label', async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse({ job: { ...jobBase, state: 'PENDING_UPLOAD' }, upload: presign }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            ...jobBase,
            state: 'FAILED',
            errorCode: 'INVOICE_TOTAL_MISMATCH',
          },
        }),
      );
    const first = renderHook(() => useAwsInvoiceUpload());
    act(() => first.result.current.start(new File(['pdf'], 'invoice.pdf')));
    await waitFor(() => expect(first.result.current.state.phase).toBe('failed'));
    expect(first.result.current.state).toMatchObject({
      error: expect.stringMatching(/total/i),
    });
    first.unmount();

    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse({ job: { ...jobBase, state: 'PENDING_UPLOAD' }, upload: presign }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: { ...jobBase, state: 'SUCCEEDED', yearMonth: '2026-07' },
        }),
      );
    const changed = vi.fn();
    window.addEventListener('cashight:aws-invoices-changed', changed);
    const second = renderHook(() => useAwsInvoiceUpload());
    act(() => second.result.current.start(new File(['pdf'], 'invoice.pdf')));
    await waitFor(() =>
      expect(second.result.current.state.phase).toBe('succeeded'),
    );
    expect(toast.success).toHaveBeenCalledWith('Invoice saved');
    expect(changed).toHaveBeenCalledOnce();
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({
      yearMonth: '2026-07',
    });
    window.removeEventListener('cashight:aws-invoices-changed', changed);
  });
});

describe('useAwsInvoices', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads typed detail, dashboard, and history concurrently with abort signals', async () => {
    queueSuccessfulLoads();

    const { result } = renderHook(() => useAwsInvoices('2026-07'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.invoice).toEqual(invoice);
    expect(result.current.dashboard).toEqual(dashboard);
    expect(result.current.history).toEqual([historyItem]);
    expect(mockApiFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/aws/invoices/2026-07',
      'https://api.example.com/aws/invoices/dashboard?yearMonth=2026-07',
      'https://api.example.com/aws/invoices',
    ]);
    for (const [, init] of mockApiFetch.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('rejects uncontracted private response fields', async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse({ invoice: { ...invoice, billTo: 'private' } }))
      .mockResolvedValueOnce(jsonResponse({ dashboard }))
      .mockResolvedValueOnce(jsonResponse({ items: [historyItem], nextCursor: null }));

    const { result } = renderHook(() => useAwsInvoices('2026-07'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.invoice).toBeNull();
  });

  it('treats a missing selected month as an empty state while preserving history', async () => {
    mockApiFetch
      .mockRejectedValueOnce(new ApiRequestError(404, { error: { code: 'NOT_FOUND' } }))
      .mockRejectedValueOnce(new ApiRequestError(404, { error: { code: 'NOT_FOUND' } }))
      .mockResolvedValueOnce(jsonResponse({ items: [historyItem], nextCursor: null }));

    const { result } = renderHook(() => useAwsInvoices('2026-08'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.invoice).toBeNull();
    expect(result.current.dashboard).toBeNull();
    expect(result.current.history).toEqual([historyItem]);
    expect(result.current.error).toBeNull();
  });

  it('preserves successful data when delete fails', async () => {
    queueSuccessfulLoads();
    const { result } = renderHook(() => useAwsInvoices('2026-07'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockApiFetch.mockRejectedValueOnce(new Error('Delete unavailable'));

    await act(async () => {
      await expect(result.current.deleteInvoice('2026-07')).rejects.toThrow(
        'Delete unavailable',
      );
    });

    expect(result.current.invoice).toEqual(invoice);
    expect(result.current.dashboard).toEqual(dashboard);
    expect(result.current.history).toEqual([historyItem]);
    expect(result.current.error).toBe('Delete unavailable');
  });

  it('reloads the selected month after an invoice change event', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.endsWith('/aws/invoices/2026-07')) {
        return Promise.resolve(jsonResponse({ invoice }));
      }
      if (url.includes('/aws/invoices/dashboard')) {
        return Promise.resolve(jsonResponse({ dashboard }));
      }
      return Promise.resolve(
        jsonResponse({ items: [historyItem], nextCursor: null }),
      );
    });
    const { result } = renderHook(() => useAwsInvoices('2026-07'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initialCalls = mockApiFetch.mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new CustomEvent('cashight:aws-invoices-changed', {
          detail: { yearMonth: '2026-07' },
        }),
      );
    });

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledTimes(initialCalls + 3),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
