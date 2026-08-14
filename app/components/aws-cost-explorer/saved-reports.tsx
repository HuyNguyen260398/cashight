'use client';

import { useMemo, useState } from 'react';
import { Bookmark, Loader2, Save, Trash2 } from 'lucide-react';
import type {
  CostExplorerReportRequest,
  SavedCostReport,
} from '@cashight/domain/aws-cost-explorer';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const selectClassName =
  'h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-theme-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300';

export interface SavedReportsProps {
  reports: SavedCostReport[];
  currentRequest: CostExplorerReportRequest;
  loading: boolean;
  error: { message: string } | null;
  onLoad: (request: CostExplorerReportRequest) => void;
  onSave: (
    name: string,
    request: CostExplorerReportRequest,
    reportId?: string,
  ) => Promise<SavedCostReport>;
  onDelete: (reportId: string) => Promise<void>;
  /**
   * Rendered inside the narrow parameters sidebar rather than a full-width
   * panel. The breakpoints below are viewport-based, so a section that only
   * asks "is the viewport wide?" lays out for room this panel does not have —
   * which is why every sibling section in report-parameters.tsx takes this
   * flag and collapses to a single column at xl, where the sidebar appears.
   */
  compact?: boolean;
}

export function SavedReports({
  reports,
  currentRequest,
  loading,
  error,
  onLoad,
  onSave,
  onDelete,
  compact = false,
}: SavedReportsProps) {
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [mutation, setMutation] = useState<'save' | 'rename' | 'delete' | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selected = useMemo(
    () => reports.find((report) => report.reportId === selectedId),
    [reports, selectedId],
  );

  // xl is where the parameters panel becomes a ~300px sidebar. Side-by-side
  // field and actions do not fit there: the field collapsed to 26px and the
  // buttons overflowed the panel border. Stacking matches what every other
  // section of report-parameters.tsx already does in compact mode.
  const fieldGrid = cn(
    'grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]',
    compact && 'xl:grid-cols-1',
  );
  const actionGroup = cn(
    'grid gap-3 self-end grid-cols-2',
    compact && 'xl:grid-cols-1',
  );
  const labelClassName =
    'space-y-1 text-xs font-medium text-gray-700 dark:text-gray-300';

  const duplicate = (candidate: string, exceptId?: string) =>
    reports.some(
      (report) =>
        report.reportId !== exceptId &&
        report.name.normalize('NFKC').toLowerCase() ===
          candidate.normalize('NFKC').toLowerCase(),
    );

  const save = async (rename: boolean) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Enter a report name.');
      return;
    }
    if (duplicate(trimmed, rename ? selectedId : undefined)) {
      setLocalError('A saved report already uses that name.');
      return;
    }
    setMutation(rename ? 'rename' : 'save');
    setLocalError(null);
    setMessage(null);
    try {
      const request = rename && selected ? selected.request : currentRequest;
      const report = await onSave(
        trimmed,
        request,
        rename ? selectedId : undefined,
      );
      setSelectedId(report.reportId);
      setName('');
      setMessage(rename ? 'Report renamed.' : 'Report saved.');
    } catch (saveError) {
      setLocalError(
        saveError instanceof Error ? saveError.message : 'Could not save report.',
      );
    } finally {
      setMutation(null);
    }
  };

  const remove = async () => {
    if (!selectedId) return;
    setMutation('delete');
    setLocalError(null);
    setMessage(null);
    try {
      await onDelete(selectedId);
      setSelectedId('');
      setDeleteOpen(false);
      setMessage('Report deleted.');
    } catch (deleteError) {
      setLocalError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete report.',
      );
    } finally {
      setMutation(null);
    }
  };

  return (
    <section
      aria-labelledby="saved-cost-reports-heading"
      className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
    >
      <div className="flex items-center gap-2">
        <Bookmark className="size-4 text-brand-500" aria-hidden />
        <h3
          id="saved-cost-reports-heading"
          className="text-sm font-semibold text-gray-900 dark:text-white/90"
        >
          Saved reports
        </h3>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading saved reports…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-600 dark:text-error-400">
          {error.message}
        </p>
      )}

      {/* One grid for both rows, so the two fields share a column track and
          their right edges line up. Separate grids sized their own 1fr column
          against a different number of action columns, leaving the wider row's
          field visibly short. */}
      <div className={fieldGrid}>
        <label className={labelClassName}>
          <span>Saved report</span>
          <select
            aria-label="Saved report"
            className={selectClassName}
            value={selectedId}
            disabled={loading || reports.length === 0}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setLocalError(null);
              setMessage(null);
            }}
          >
            <option value="">Select a report</option>
            {reports.map((report) => (
              <option key={report.reportId} value={report.reportId}>
                {report.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-end"
          disabled={!selected || mutation !== null}
          onClick={() => selected && onLoad(selected.request)}
        >
          Load report
        </Button>

        <label className={labelClassName}>
          <span>Report name</span>
          <Input
            aria-label="Report name"
            value={name}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value);
              setLocalError(null);
              setMessage(null);
            }}
          />
        </label>
        <div className={actionGroup}>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={mutation !== null}
            onClick={() => void save(false)}
          >
            {mutation === 'save' ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            Save as new
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!selected || mutation !== null}
            onClick={() => void save(true)}
          >
            Rename report
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" className="min-w-0 flex-1">
          {localError && (
            <p role="alert" className="text-sm text-error-600 dark:text-error-400">
              {localError}
            </p>
          )}
          {message && <p className="text-sm text-success-600">{message}</p>}
        </div>
        <Button
          type="button"
          variant="destructive"
          className={cn('min-h-11', compact && 'xl:w-full')}
          disabled={!selected || mutation !== null}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 aria-hidden />
          Delete report
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved report?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes {selected?.name ?? 'the selected report'} from Cashight.
              It does not change AWS cost data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation === 'delete'}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              aria-label="Confirm delete report"
              className={buttonVariants({ variant: 'destructive' })}
              disabled={mutation === 'delete'}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {mutation === 'delete' ? 'Deleting…' : 'Delete report'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
