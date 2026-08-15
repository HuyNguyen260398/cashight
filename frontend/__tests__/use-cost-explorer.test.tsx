// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCostExplorer } from '../hooks/use-cost-explorer';
import { ApiRequestError } from '../api/client';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const API_BASE_URL = 'https://api.example.com';
const DOWNLOAD_URL = 'https://cost-exports.s3.amazonaws.com/private.csv?signature=signed';
const DIGEST = 'a'.repeat(64);

const reportRequest: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-01-01', end: '2026-03-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

function queryBody(
  total = '3.30',
  source: 'AWS' | 'CACHE' = 'AWS',
  refreshCooldownUntil?: string,
) {
  return {
    digest: DIGEST,
    result: {
      source,
      asOf: '2026-08-09T00:00:00.000Z',
      currencyOrUnit: 'USD',
      estimated: false,
      overview: { total, average: total },
      periods: [
        { start: '2026-01-01', end: '2026-02-01', estimated: false },
      ],
      series: [
        {
          key: 'Example Compute',
          label: 'Example Compute',
          values: [total],
          total,
        },
      ],
      breakdown: [
        {
          groupValues: ['Example Compute'],
          values: [total],
          total,
          estimated: false,
        },
      ],
      comparisonDrivers: [],
      pageCount: 1,
    },
    ...(refreshCooldownUntil ? { refreshCooldownUntil } : {}),
  };
}

function savedReport(name = 'Monthly services') {
  return {
    reportId: REPORT_ID,
    name,
    request: reportRequest,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

const mockApiFetch = vi.fn();

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../auth/config', () => ({
  getPublicConfig: () => ({ apiBaseUrl: API_BASE_URL }),
}));

describe('useCostExplorer report state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `${API_BASE_URL}/aws/cost-explorer/reports` && !init?.method) {
        return response({ items: [] });
      }
      if (url === `${API_BASE_URL}/aws/cost-explorer/query`) {
        return response(queryBody());
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
  });

  it('moves through idle, loading, and success with a validated result', async () => {
    const pending = deferred<Response>();
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/reports')) return response({ items: [] });
      return pending.promise;
    });
    const { result } = renderHook(() => useCostExplorer());

    expect(result.current.state.status).toBe('idle');
    act(() => result.current.run(reportRequest));
    expect(result.current.state.status).toBe('loading');

    await act(async () => {
      pending.resolve(response(queryBody()));
      await pending.promise;
    });

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.state.result?.overview.total).toBe('3.30');
  });

  it('publishes an error for a failed or malformed report response', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/reports')) return response({ items: [] });
      return response({ digest: DIGEST, result: { source: 'AWS' } });
    });
    const { result } = renderHook(() => useCostExplorer());

    act(() => result.current.run(reportRequest));

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state.error?.message).toMatch(/invalid/i);
  });

  it('aborts a superseded query and suppresses its stale response', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const reportCalls: RequestInit[] = [];
    mockApiFetch.mockImplementation(
      async (url: string, init: RequestInit = {}) => {
        if (url.endsWith('/reports')) return response({ items: [] });
        reportCalls.push(init);
        return reportCalls.length === 1 ? first.promise : second.promise;
      },
    );
    const { result } = renderHook(() => useCostExplorer());
    const newerRequest = {
      ...reportRequest,
      timePeriod: { start: '2026-03-01', end: '2026-04-01' },
    };

    act(() => result.current.run(reportRequest));
    act(() => result.current.run(newerRequest));

    expect((reportCalls[0].signal as AbortSignal).aborted).toBe(true);
    await act(async () => {
      second.resolve(response(queryBody('9.90')));
      await second.promise;
    });
    await waitFor(() =>
      expect(result.current.state.result?.overview.total).toBe('9.90'),
    );

    await act(async () => {
      first.resolve(response(queryBody('1.10')));
      await first.promise;
    });
    expect(result.current.state.result?.overview.total).toBe('9.90');
  });

  it('cancel aborts the active query and returns to idle', () => {
    const pending = deferred<Response>();
    let signal: AbortSignal | undefined;
    mockApiFetch.mockImplementation(
      async (url: string, init: RequestInit = {}) => {
        if (url.endsWith('/reports')) return response({ items: [] });
        signal = init.signal ?? undefined;
        return pending.promise;
      },
    );
    const { result } = renderHook(() => useCostExplorer());

    act(() => result.current.run(reportRequest));
    act(() => result.current.cancel());

    expect(signal?.aborted).toBe(true);
    expect(result.current.state.status).toBe('idle');
  });

  it('preserves cached freshness and the manual refresh cooldown', async () => {
    const cooldown = '2026-08-09T00:05:00.000Z';
    mockApiFetch.mockImplementation(
      async (url: string, init: RequestInit = {}) => {
        if (url.endsWith('/reports')) return response({ items: [] });
        const body = JSON.parse(String(init.body)) as { refresh?: boolean };
        return response(
          body.refresh
            ? queryBody('3.30', 'CACHE', cooldown)
            : queryBody('3.30', 'CACHE'),
        );
      },
    );
    const { result } = renderHook(() => useCostExplorer());
    act(() => result.current.run(reportRequest));
    await waitFor(() => expect(result.current.state.status).toBe('success'));

    expect(result.current.state.freshness).toEqual({
      source: 'CACHE',
      asOf: '2026-08-09T00:00:00.000Z',
    });

    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.state.refreshCooldownUntil).toBe(cooldown),
    );
    const queryCalls = mockApiFetch.mock.calls.filter(([url]) =>
      String(url).endsWith('/query'),
    );
    expect(JSON.parse(String(queryCalls[1][1].body))).toEqual({
      request: reportRequest,
      refresh: true,
    });
  });

  it('keeps a successful cost query when AWS rejects only the forecast combination', async () => {
    const forecastRequest: CostExplorerReportRequest = {
      ...reportRequest,
      groupBy: [],
      showForecast: true,
    };
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/reports')) return response({ items: [] });
      if (url.endsWith('/query')) return response(queryBody());
      if (url.endsWith('/forecast')) {
        throw new ApiRequestError(422, {
          error: {
            code: 'INVALID_COST_QUERY',
            message: 'Forecast is unavailable for this range.',
            retryable: false,
          },
        });
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { result } = renderHook(() => useCostExplorer());

    act(() => result.current.run(forecastRequest));

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.state.result?.overview.total).toBe('3.30');
    expect(result.current.state.forecast).toBeNull();
  });

  it('does not hide a forecast authorization denial behind unavailable UI', async () => {
    const forecastRequest: CostExplorerReportRequest = {
      ...reportRequest,
      groupBy: [],
      showForecast: true,
    };
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/reports')) return response({ items: [] });
      if (url.endsWith('/query')) return response(queryBody());
      if (url.endsWith('/forecast')) {
        throw new ApiRequestError(403, {
          error: {
            code: 'COGNITO_REAUTH_REQUIRED',
            message: 'A native Cognito session is required.',
            retryable: false,
          },
        });
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { result } = renderHook(() => useCostExplorer());

    act(() => result.current.run(forecastRequest));

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state.error?.code).toBe('COGNITO_REAUTH_REQUIRED');
  });
});

describe('useCostExplorer saved reports and export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists, saves, renames, and deletes validated reports', async () => {
    mockApiFetch.mockImplementation(
      async (url: string, init: RequestInit = {}) => {
        if (url.endsWith('/reports') && !init.method) {
          return response({ items: [savedReport()] });
        }
        if (url.endsWith('/reports') && init.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { name: string };
          return response({ report: savedReport(body.name) }, 201);
        }
        if (url.endsWith(`/reports/${REPORT_ID}`) && init.method === 'DELETE') {
          return response({ reportId: REPORT_ID, deleted: true });
        }
        throw new Error(`Unexpected API request: ${url}`);
      },
    );
    const { result } = renderHook(() => useCostExplorer());
    await waitFor(() => expect(result.current.reports).toHaveLength(1));

    await act(async () => {
      await result.current.saveReport('Renamed services', reportRequest, REPORT_ID);
    });
    expect(result.current.reports[0].name).toBe('Renamed services');

    await act(async () => {
      await result.current.deleteReport(REPORT_ID);
    });
    expect(result.current.reports).toEqual([]);
  });

  it('downloads a presigned CSV without forwarding API authorization', async () => {
    mockApiFetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/reports') && !init.method) {
        return response({ items: [] });
      }
      if (url.endsWith('/export')) {
        return response({
          downloadUrl: DOWNLOAD_URL,
          expiresAt: '2026-08-09T00:05:00.000Z',
          fileName: 'cashight-cost-explorer-2026-08-09.csv',
        });
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    const nativeFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Service,Total\nCompute,3.30'));
    const clicked: Array<{ href: string; download: string }> = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
      });
    const createObjectUrl = vi.fn(() => 'blob:https://app.example.com/csv');
    const revokeObjectUrl = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectUrl },
      revokeObjectURL: { configurable: true, value: revokeObjectUrl },
    });
    const { result } = renderHook(() => useCostExplorer());

    await act(async () => {
      await result.current.exportCsv(reportRequest);
    });

    expect(nativeFetch).toHaveBeenCalledWith(DOWNLOAD_URL);
    expect(nativeFetch.mock.calls[0][1]).toBeUndefined();
    expect(clicked).toEqual([
      {
        href: 'blob:https://app.example.com/csv',
        download: 'cashight-cost-explorer-2026-08-09.csv',
      },
    ]);
    expect(revokeObjectUrl).toHaveBeenCalledWith(
      'blob:https://app.example.com/csv',
    );
    expect(
      mockApiFetch.mock.calls.some(([url]) => String(url) === DOWNLOAD_URL),
    ).toBe(false);
    click.mockRestore();
  });
});
