'use client';

import { useEffect } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FileDropzone from '@cloudscape-design/components/file-dropzone';
import FileInput from '@cloudscape-design/components/file-input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { notify } from '@/app/components/console/notifications';
import { bankShortName, type BankCode } from '@/lib/banks';
import type { UploadJob } from '@/frontend/api/contracts';
import { useUploadJob } from '@/frontend/hooks/use-upload-job';
import { pickPdf } from './pdf-file';

/**
 * Drag-and-drop PDF uploader (Cloudscape FileDropzone + FileInput). Implements the presigned-upload flow:
 *   1. Hash the file with SHA-256
 *   2. POST /uploads → get presigned S3 URL
 *   3. PUT the PDF directly to S3 (plain fetch, no auth header)
 *   4. Poll GET /uploads/:jobId until terminal state
 *
 * On CONFLICT the user is prompted to confirm before force-overwriting.
 * A success callback lets the dashboard refresh metadata and select the saved month.
 */
export function UploadDropzone({ bank, onSucceeded }: {
  bank?: BankCode;
  onSucceeded?: (job: UploadJob) => void;
} = {}) {
  const { state, start, reset } = useUploadJob(onSucceeded);

  const isWorking = state.phase === 'working';

  useEffect(() => {
    if (state.phase === 'succeeded') {
      const timer = setTimeout(() => reset(), 1500);
      return () => clearTimeout(timer);
    }
  }, [state.phase, reset]);

  function accept(files: readonly File[]) {
    if (isWorking) return;
    const picked = pickPdf(files);
    if (!picked) return;
    if ('error' in picked) notify({ type: 'error', content: picked.error });
    else start(picked.file);
  }

  const pendingConflict = state.phase === 'conflict' ? state : null;

  const monthYearLabel = pendingConflict
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
        new Date(pendingConflict.conflict.year, pendingConflict.conflict.month - 1),
      )
    : '';

  const workingMessage = state.phase === 'working' ? state.message : 'Processing…';

  return (
    <Container>
      <SpaceBetween size="s">
        <FileDropzone onChange={({ detail }) => accept(detail.value)}>
          <Box textAlign="center" padding={{ vertical: 'l' }}>
            {isWorking ? (
              <StatusIndicator type="loading">{workingMessage}</StatusIndicator>
            ) : (
              <SpaceBetween size="s" alignItems="center">
                <Box variant="h3" tagOverride="p">
                  Drag a {bank ? bankShortName(bank) : 'TPB or VIB'} statement PDF here
                </Box>
                <Box color="text-body-secondary">
                  or choose a PDF file up to 5 MB. The bank is detected automatically.
                </Box>
                <StatusIndicator type="success">Card data is masked before storage</StatusIndicator>
              </SpaceBetween>
            )}
            {/* Always mounted: a file can be chosen any time; accept() ignores picks during an upload. */}
            <Box margin={{ top: 's' }}>
              <FileInput ariaLabel="Statement PDF" accept="application/pdf,.pdf" value={[]} onChange={({ detail }) => accept(detail.value)}>
                    Choose file
                  </FileInput>
            </Box>
          </Box>
        </FileDropzone>

        {state.phase === 'failed' && <Alert type="error">{state.error}</Alert>}
      </SpaceBetween>

      {pendingConflict ? (
        <Modal
          visible
          onDismiss={() => {
            if (!isWorking) reset();
          }}
          closeAriaLabel="Close"
          header="Replace existing statement?"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" disabled={isWorking} onClick={() => reset()}>
                  Cancel
                </Button>
                <Button variant="primary" loading={isWorking} onClick={() => start(pendingConflict.file, true)}>
                  {isWorking ? 'Replacing…' : 'Replace'}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          A statement for {monthYearLabel} (****{pendingConflict.conflict.cardLast4}) already exists. Replacing it
          keeps the previous version for 90 days.
        </Modal>
      ) : null}
    </Container>
  );
}
