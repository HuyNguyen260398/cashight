'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CostExplorerReportRequestSchema,
  type CostExplorerReportRequest,
  type SavedCostReport,
} from '@cashight/domain/aws-cost-explorer';
import { z } from 'zod';

import { ApiRequestError, apiFetch } from '@/frontend/api/client';
import {
  ApiErrorBodySchema,
  CostCsvExportResponseSchema,
  CostExplorerComparisonResponseSchema,
  CostExplorerForecastResponseSchema,
  CostExplorerQueryResponseSchema,
  DeleteSavedCostReportResponseSchema,
  PutSavedCostReportRequestSchema,
  SavedCostReportResponseSchema,
  SavedCostReportsResponseSchema,
  type CostExplorerComparison,
  type CostExplorerCompleteResult,
  type CostExplorerForecast,
} from '@/frontend/api/contracts';
import { getPublicConfig } from '@/frontend/auth/config';

export interface CostExplorerClientError {
  code?: string;
  message: string;
  retryable?: boolean;
}

export interface CostExplorerHookState {
  status: 'idle' | 'loading' | 'success' | 'error';
  request: CostExplorerReportRequest | null;
  result: CostExplorerCompleteResult | null;
  forecast: CostExplorerForecast | null;
  comparison: CostExplorerComparison | null;
  freshness: { source: 'AWS' | 'CACHE'; asOf: string } | null;
  refreshCooldownUntil: string | null;
  error: CostExplorerClientError | null;
}

const IDLE_STATE: CostExplorerHookState = {
  status: 'idle',
  request: null,
  result: null,
  forecast: null,
  comparison: null,
  freshness: null,
  refreshCooldownUntil: null,
  error: null,
};

function clientError(error: unknown): CostExplorerClientError {
  if (error instanceof ApiRequestError) {
    const parsed = ApiErrorBodySchema.safeParse(error.body);
    if (parsed.success) {
      return {
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        retryable: parsed.data.error.retryable,
      };
    }
  }
  if (error instanceof z.ZodError) {
    return { message: 'The Cost Explorer API returned an invalid response.' };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'The Cost Explorer request failed.' };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isForecastUnavailable(error: unknown): boolean {
  const code = clientError(error).code;
  return code === 'INVALID_COST_QUERY' || code === 'GRANULARITY_NOT_AVAILABLE';
}

function sortReports(reports: SavedCostReport[]): SavedCostReport[] {
  return [...reports].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
  );
}

async function parsedJson<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  return schema.parse(await response.json());
}

export interface CostExplorerHookOptions {
  /**
   * Fetch the saved-report list on mount. Callers that render no saved-report
   * UI — the invoice dashboard's embedded graph — pass `false` so the page does
   * not spend a request whose result and errors nothing consumes. Read once, at
   * mount: it identifies the call site, not a changing piece of state.
   */
  loadReports?: boolean;
}

export function useCostExplorer(options?: CostExplorerHookOptions): {
  state: CostExplorerHookState;
  reports: SavedCostReport[];
  reportsLoading: boolean;
  reportsError: CostExplorerClientError | null;
  run: (request: CostExplorerReportRequest) => void;
  refresh: () => void;
  saveReport: (
    name: string,
    request: CostExplorerReportRequest,
    reportId?: string,
  ) => Promise<SavedCostReport>;
  deleteReport: (reportId: string) => Promise<void>;
  exportCsv: (request?: CostExplorerReportRequest) => Promise<void>;
  cancel: () => void;
} {
  const loadReports = options?.loadReports ?? true;
  const [state, setState] = useState<CostExplorerHookState>(IDLE_STATE);
  const [reports, setReports] = useState<SavedCostReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(loadReports);
  const [reportsError, setReportsError] =
    useState<CostExplorerClientError | null>(null);
  // A ref rather than an effect dependency: the mount effect also owns the
  // query abort, so re-running it would cancel an in-flight report. Never
  // reassigned — the mount-time value is the one the effect wants.
  const loadReportsRef = useRef(loadReports);
  const generationRef = useRef(0);
  const reportListGenerationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef<CostExplorerReportRequest | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++reportListGenerationRef.current;
    if (loadReportsRef.current) {
      const { apiBaseUrl } = getPublicConfig();
      void apiFetch(`${apiBaseUrl}/aws/cost-explorer/reports`)
        .then((response) => parsedJson(response, SavedCostReportsResponseSchema))
        .then(({ items }) => {
          if (
            mountedRef.current &&
            reportListGenerationRef.current === generation
          ) {
            setReports(sortReports(items));
            setReportsError(null);
          }
        })
        .catch((error: unknown) => {
          if (
            mountedRef.current &&
            reportListGenerationRef.current === generation
          ) {
            setReportsError(clientError(error));
          }
        })
        .finally(() => {
          if (
            mountedRef.current &&
            reportListGenerationRef.current === generation
          ) {
            setReportsLoading(false);
          }
        });
    }

    return () => {
      mountedRef.current = false;
      reportListGenerationRef.current += 1;
      generationRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  const execute = useCallback(
    (rawRequest: CostExplorerReportRequest, refresh: boolean) => {
      let request: CostExplorerReportRequest;
      try {
        request = CostExplorerReportRequestSchema.parse(rawRequest);
      } catch (error) {
        setState({
          ...IDLE_STATE,
          status: 'error',
          request: rawRequest,
          error: clientError(error),
        });
        return;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const generation = ++generationRef.current;
      activeRequestRef.current = request;
      setState({
        ...IDLE_STATE,
        status: 'loading',
        request,
      });

      const { apiBaseUrl } = getPublicConfig();
      void (async () => {
        try {
          if (request.mode === 'COMPARISON') {
            const response = await apiFetch(
              `${apiBaseUrl}/aws/cost-explorer/comparisons`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request }),
                signal: controller.signal,
              },
            );
            const { comparison } = await parsedJson(
              response,
              CostExplorerComparisonResponseSchema,
            );
            if (generationRef.current !== generation) return;
            setState({
              ...IDLE_STATE,
              status: 'success',
              request,
              comparison,
            });
            return;
          }

          const queryPromise = apiFetch(
            `${apiBaseUrl}/aws/cost-explorer/query`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ request, refresh }),
              signal: controller.signal,
            },
          ).then((response) =>
            parsedJson(response, CostExplorerQueryResponseSchema),
          );
          const forecastPromise = request.showForecast
            ? apiFetch(`${apiBaseUrl}/aws/cost-explorer/forecast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request }),
                signal: controller.signal,
              })
                .then((response) =>
                  parsedJson(response, CostExplorerForecastResponseSchema),
                )
                .catch((error: unknown) => {
                  if (isForecastUnavailable(error)) return null;
                  throw error;
                })
            : Promise.resolve(null);
          const [query, forecastResponse] = await Promise.all([
            queryPromise,
            forecastPromise,
          ]);
          if (generationRef.current !== generation) return;
          setState({
            status: 'success',
            request,
            result: query.result,
            forecast: forecastResponse?.forecast ?? null,
            comparison: null,
            freshness: {
              source: query.result.source,
              asOf: query.result.asOf,
            },
            refreshCooldownUntil: query.refreshCooldownUntil ?? null,
            error: null,
          });
        } catch (error) {
          if (
            generationRef.current !== generation ||
            controller.signal.aborted ||
            isAbort(error)
          ) {
            return;
          }
          setState({
            ...IDLE_STATE,
            status: 'error',
            request,
            error: clientError(error),
          });
        }
      })();
    },
    [],
  );

  const run = useCallback(
    (request: CostExplorerReportRequest) => execute(request, false),
    [execute],
  );

  const refresh = useCallback(() => {
    if (activeRequestRef.current) execute(activeRequestRef.current, true);
  }, [execute]);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeRequestRef.current = null;
    setState(IDLE_STATE);
  }, []);

  const saveReport = useCallback(
    async (
      name: string,
      rawRequest: CostExplorerReportRequest,
      reportId?: string,
    ): Promise<SavedCostReport> => {
      const input = PutSavedCostReportRequestSchema.parse({
        ...(reportId ? { reportId } : {}),
        name,
        request: rawRequest,
      });
      const { apiBaseUrl } = getPublicConfig();
      const response = await apiFetch(
        `${apiBaseUrl}/aws/cost-explorer/reports`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      const { report } = await parsedJson(
        response,
        SavedCostReportResponseSchema,
      );
      if (mountedRef.current) {
        reportListGenerationRef.current += 1;
        setReports((current) =>
          sortReports([
            ...current.filter((item) => item.reportId !== report.reportId),
            report,
          ]),
        );
        setReportsError(null);
        setReportsLoading(false);
      }
      return report;
    },
    [],
  );

  const deleteReport = useCallback(async (reportId: string): Promise<void> => {
    const safeReportId = z.string().uuid().parse(reportId);
    const { apiBaseUrl } = getPublicConfig();
    const response = await apiFetch(
      `${apiBaseUrl}/aws/cost-explorer/reports/${encodeURIComponent(safeReportId)}`,
      { method: 'DELETE' },
    );
    await parsedJson(response, DeleteSavedCostReportResponseSchema);
    if (mountedRef.current) {
      reportListGenerationRef.current += 1;
      setReports((current) =>
        current.filter((report) => report.reportId !== safeReportId),
      );
      setReportsError(null);
      setReportsLoading(false);
    }
  }, []);

  const exportCsv = useCallback(
    async (rawRequest?: CostExplorerReportRequest): Promise<void> => {
      const request = CostExplorerReportRequestSchema.parse(
        rawRequest ?? activeRequestRef.current,
      );
      const { apiBaseUrl } = getPublicConfig();
      const response = await apiFetch(
        `${apiBaseUrl}/aws/cost-explorer/export`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request }),
        },
      );
      const exported = await parsedJson(response, CostCsvExportResponseSchema);

      const downloadResponse = await fetch(exported.downloadUrl);
      if (!downloadResponse.ok) {
        throw new Error(`CSV download failed (HTTP ${downloadResponse.status})`);
      }
      const blobUrl = URL.createObjectURL(await downloadResponse.blob());
      try {
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = exported.fileName;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    },
    [],
  );

  return {
    state,
    reports,
    reportsLoading,
    reportsError,
    run,
    refresh,
    saveReport,
    deleteReport,
    exportCsv,
    cancel,
  };
}
