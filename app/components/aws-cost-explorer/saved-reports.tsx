'use client';

import { useMemo, useState } from 'react';
import type {
  CostExplorerReportRequest,
  SavedCostReport,
} from '@cashight/domain/aws-cost-explorer';

import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { SelectField } from './fields';

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

  const busy = mutation !== null;

  return (
    <section aria-labelledby="saved-cost-reports-heading">
      <Container
        variant="stacked"
        header={
          <Header variant="h3">
            <span id="saved-cost-reports-heading">Saved reports</span>
          </Header>
        }
      >
        <SpaceBetween size="s">
          {loading && <StatusIndicator type="loading">Loading saved reports…</StatusIndicator>}
          {error && (
            <Box color="text-status-error">
              <span role="alert">{error.message}</span>
            </Box>
          )}

          <ColumnLayout columns={compact ? 1 : 2}>
            <SpaceBetween size="xs">
              <SelectField
                label="Saved report"
                value={selectedId}
                disabled={loading || reports.length === 0}
                options={[
                  { value: '', label: 'Select a report' },
                  ...reports.map((report) => ({ value: report.reportId, label: report.name })),
                ]}
                onChange={(value) => {
                  setSelectedId(value);
                  setLocalError(null);
                  setMessage(null);
                }}
              />
              <Button disabled={!selected || busy} onClick={() => selected && onLoad(selected.request)}>
                Load report
              </Button>
            </SpaceBetween>
            <SpaceBetween size="xs">
              <FormField label="Report name">
                <Input
                  ariaLabel="Report name"
                  value={name}
                  onChange={({ detail }) => {
                    setName(detail.value.slice(0, 80));
                    setLocalError(null);
                    setMessage(null);
                  }}
                />
              </FormField>
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="upload" loading={mutation === 'save'} disabled={busy && mutation !== 'save'} onClick={() => void save(false)}>
                  Save as new
                </Button>
                <Button disabled={!selected || busy} onClick={() => void save(true)}>
                  Rename report
                </Button>
                <Button iconName="remove" disabled={!selected || busy} onClick={() => setDeleteOpen(true)}>
                  Delete report
                </Button>
              </SpaceBetween>
            </SpaceBetween>
          </ColumnLayout>

          <div aria-live="polite">
            {localError && (
              <div role="alert">
                <StatusIndicator type="error">{localError}</StatusIndicator>
              </div>
            )}
            {message && <StatusIndicator type="success">{message}</StatusIndicator>}
          </div>
        </SpaceBetween>
      </Container>

      {deleteOpen ? (
        <Modal
          visible
          closeAriaLabel="Close"
          onDismiss={() => {
            if (mutation !== 'delete') setDeleteOpen(false);
          }}
          header="Delete saved report?"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" disabled={mutation === 'delete'} onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  ariaLabel="Confirm delete report"
                  loading={mutation === 'delete'}
                  onClick={() => void remove()}
                >
                  {mutation === 'delete' ? 'Deleting…' : 'Delete report'}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          This deletes {selected?.name ?? 'the selected report'} from Cashight. It does not change AWS cost data.
        </Modal>
      ) : null}
    </section>
  );
}
