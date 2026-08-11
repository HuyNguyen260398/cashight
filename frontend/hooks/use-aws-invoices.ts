'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AwsInvoice,
  AwsInvoiceDashboard,
  YearMonth,
} from '@cashight/domain/aws-invoices';

import { apiFetch } from '@/frontend/api/client';
import {
  AwsInvoiceDashboardResponseSchema,
  AwsInvoiceDetailResponseSchema,
  AwsInvoiceListResponseSchema,
  DeleteAwsInvoiceResponseSchema,
  type AwsInvoiceListItem,
} from '@/frontend/api/contracts';
import { getPublicConfig } from '@/frontend/auth/config';
import { AWS_INVOICES_CHANGED_EVENT } from './use-aws-invoice-upload';

interface LoadedInvoices {
  requestKey: string | null;
  epoch: number;
  invoice: AwsInvoice | null;
  dashboard: AwsInvoiceDashboard | null;
  history: AwsInvoiceListItem[];
  nextCursor: string | null;
  error: string | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useAwsInvoices(yearMonth: YearMonth | null): {
  invoice: AwsInvoice | null;
  dashboard: AwsInvoiceDashboard | null;
  history: AwsInvoiceListItem[];
  nextCursor: string | null;
  loading: boolean;
  deleting: boolean;
  error: string | null;
  deleteInvoice: (target: YearMonth) => Promise<void>;
  refresh: () => void;
} {
  const [epoch, setEpoch] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedInvoices>({
    requestKey: null,
    epoch: -1,
    invoice: null,
    dashboard: null,
    history: [],
    nextCursor: null,
    error: null,
  });

  const requestKey = yearMonth ?? 'history-only';
  const loading = loaded.requestKey !== requestKey || loaded.epoch !== epoch;

  useEffect(() => {
    const controller = new AbortController();
    const { apiBaseUrl } = getPublicConfig();
    const init = { signal: controller.signal };
    const detail = yearMonth
      ? apiFetch(
          `${apiBaseUrl}/aws/invoices/${encodeURIComponent(yearMonth)}`,
          init,
        ).then(async (response) =>
          AwsInvoiceDetailResponseSchema.parse(await response.json()),
        )
      : Promise.resolve(null);
    const dashboard = yearMonth
      ? apiFetch(
          `${apiBaseUrl}/aws/invoices/dashboard?yearMonth=${encodeURIComponent(yearMonth)}`,
          init,
        ).then(async (response) =>
          AwsInvoiceDashboardResponseSchema.parse(await response.json()),
        )
      : Promise.resolve(null);
    const history = apiFetch(`${apiBaseUrl}/aws/invoices`, init).then(
      async (response) =>
        AwsInvoiceListResponseSchema.parse(await response.json()),
    );

    void Promise.all([detail, dashboard, history])
      .then(([detailResponse, dashboardResponse, historyResponse]) => {
        if (controller.signal.aborted) return;
        setMutationError(null);
        setLoaded({
          requestKey,
          epoch,
          invoice: detailResponse?.invoice ?? null,
          dashboard: dashboardResponse?.dashboard ?? null,
          history: historyResponse.items,
          nextCursor: historyResponse.nextCursor,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded((previous) => ({
          requestKey,
          epoch,
          invoice:
            previous.requestKey === requestKey ? previous.invoice : null,
          dashboard:
            previous.requestKey === requestKey ? previous.dashboard : null,
          history:
            previous.requestKey === requestKey ? previous.history : [],
          nextCursor:
            previous.requestKey === requestKey ? previous.nextCursor : null,
          error: errorMessage(error, 'Failed to load AWS invoices'),
        }));
      });

    return () => controller.abort();
  }, [epoch, requestKey, yearMonth]);

  useEffect(() => {
    const handleChanged = () => setEpoch((value) => value + 1);
    window.addEventListener(AWS_INVOICES_CHANGED_EVENT, handleChanged);
    return () =>
      window.removeEventListener(AWS_INVOICES_CHANGED_EVENT, handleChanged);
  }, []);

  const refresh = useCallback(() => {
    setEpoch((value) => value + 1);
  }, []);

  const deleteInvoice = useCallback(async (target: YearMonth) => {
    setDeleting(true);
    setMutationError(null);
    try {
      const { apiBaseUrl } = getPublicConfig();
      const response = await apiFetch(
        `${apiBaseUrl}/aws/invoices/${encodeURIComponent(target)}`,
        { method: 'DELETE' },
      );
      DeleteAwsInvoiceResponseSchema.parse(await response.json());
      window.dispatchEvent(
        new CustomEvent(AWS_INVOICES_CHANGED_EVENT, {
          detail: { yearMonth: target },
        }),
      );
    } catch (error: unknown) {
      setMutationError(errorMessage(error, 'Failed to delete AWS invoice'));
      throw error;
    } finally {
      setDeleting(false);
    }
  }, []);

  const isCurrent = loaded.requestKey === requestKey;
  return {
    invoice: isCurrent ? loaded.invoice : null,
    dashboard: isCurrent ? loaded.dashboard : null,
    history: isCurrent ? loaded.history : [],
    nextCursor: isCurrent ? loaded.nextCursor : null,
    loading,
    deleting,
    error: mutationError ?? (isCurrent ? loaded.error : null),
    deleteInvoice,
    refresh,
  };
}
