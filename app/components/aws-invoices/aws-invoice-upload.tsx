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
import { pickPdf } from '@/app/components/pdf-file';
import { useAwsInvoiceUpload } from '@/frontend/hooks/use-aws-invoice-upload';
import { formatInvoiceMonth } from './invoice-format';

export function AwsInvoiceUpload() {
  const { state, start, reset } = useAwsInvoiceUpload();
  const isWorking = state.phase === 'working';

  useEffect(() => {
    if (state.phase !== 'succeeded') return;
    const timer = window.setTimeout(reset, 1500);
    return () => window.clearTimeout(timer);
  }, [reset, state.phase]);

  function accept(files: readonly File[]) {
    if (isWorking) return;
    const picked = pickPdf(files);
    if (!picked) return;
    if ('error' in picked) notify({ type: 'error', content: picked.error });
    else start(picked.file);
  }

  const conflict = state.phase === 'conflict' ? state : null;
  const month = conflict
    ? formatInvoiceMonth(`${conflict.conflict.year}-${String(conflict.conflict.month).padStart(2, '0')}`)
    : '';

  return (
    <Container>
      <SpaceBetween size="s">
        <FileDropzone onChange={({ detail }) => accept(detail.value)}>
          <Box textAlign="center" padding={{ vertical: 'm' }}>
            {isWorking ? (
              <div role="status">
                <StatusIndicator type="loading">{state.message}</StatusIndicator>
              </div>
            ) : (
              <SpaceBetween size="s" alignItems="center">
                <Box variant="h3" tagOverride="p">
                  Upload an AWS consolidated invoice
                </Box>
                <Box color="text-body-secondary">Drop or select one PDF up to 5 MB</Box>
                <StatusIndicator type="success">Private header and account data are removed</StatusIndicator>
              </SpaceBetween>
            )}
            {/* Always mounted: a file can be chosen any time; accept() ignores picks during an upload. */}
            <Box margin={{ top: 's' }}>
              <FileInput
                ariaLabel="Upload AWS invoice PDF"
                accept="application/pdf,.pdf"
                value={[]}
                onChange={({ detail }) => accept(detail.value)}
              >
                Choose file
              </FileInput>
            </Box>
          </Box>
        </FileDropzone>
        {state.phase === 'failed' && (
          <div role="alert">
            <Alert type="error">{state.error}</Alert>
          </div>
        )}
      </SpaceBetween>

      {conflict ? (
        <Modal
          visible
          closeAriaLabel="Close"
          onDismiss={reset}
          header="Replace existing invoice?"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={reset}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => start(conflict.file, true)}>
                  Replace invoice
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          An invoice for {month} already exists. Replacing it preserves the previous S3 version for 90 days.
        </Modal>
      ) : null}
    </Container>
  );
}
