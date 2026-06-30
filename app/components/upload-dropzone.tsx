'use client';

import { useDropzone } from 'react-dropzone';
import { useEffect } from 'react';
import { FileUp, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
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
import { buttonVariants } from '@/components/ui/button';
import { useUploadJob } from '@/frontend/hooks/use-upload-job';

/**
 * Drag-and-drop PDF uploader. Implements the presigned-upload flow:
 *   1. Hash the file with SHA-256
 *   2. POST /uploads → get presigned S3 URL
 *   3. PUT the PDF directly to S3 (plain fetch, no auth header)
 *   4. Poll GET /uploads/:jobId until terminal state
 *
 * On CONFLICT the user is prompted to confirm before force-overwriting.
 * No onParsed callback — the component manages its own lifecycle.
 */
export function UploadDropzone() {
  const { state, start, reset } = useUploadJob();

  const isWorking = state.phase === 'working';

  // Show a toast when the upload succeeds and automatically reset to idle
  // so the dropzone is ready for the next file.
  useEffect(() => {
    if (state.phase === 'succeeded') {
      // Toast is already shown inside the hook; just reset the UI.
      const timer = setTimeout(() => reset(), 1500);
      return () => clearTimeout(timer);
    }
  }, [state.phase, reset]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    disabled: isWorking,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length === 0) return;
      start(acceptedFiles[0]);
    },
    onDropRejected: (fileRejections) => {
      const firstError = fileRejections[0]?.errors[0];
      if (!firstError) {
        toast.error('File rejected.');
        return;
      }
      switch (firstError.code) {
        case 'file-invalid-type':
          toast.error('Only PDF files are accepted.');
          break;
        case 'file-too-large':
          toast.error('File is too large (max 5 MB).');
          break;
        default:
          toast.error(firstError.message);
      }
    },
  });

  const pendingConflict = state.phase === 'conflict' ? state : null;

  const monthYearLabel = pendingConflict
    ? new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
      }).format(
        new Date(
          pendingConflict.conflict.year,
          pendingConflict.conflict.month - 1,
        ),
      )
    : '';

  // Working step label shown while busy.
  const workingMessage =
    state.phase === 'working' ? state.message : 'Processing…';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div
        {...getRootProps()}
        className="cursor-pointer rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center transition hover:border-brand-300 hover:bg-brand-25 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800 dark:hover:bg-brand-500/10 md:p-12"
      >
        <input {...getInputProps()} />
        {isWorking ? (
          <div className="flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400">
            <Loader2 className="size-9 animate-spin text-brand-500" />
            <p className="text-sm font-medium">{workingMessage}</p>
          </div>
        ) : isDragActive ? (
          <div className="flex flex-col items-center gap-3">
            <FileUp className="size-10 text-brand-500" aria-hidden />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Drop the PDF here
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
              <FileUp className="size-7" aria-hidden />
            </div>
            <p className="text-base font-semibold text-gray-900 dark:text-white/90">
              Drag a TPBank statement PDF here
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              or click to select a PDF file up to 5 MB
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-700 dark:bg-success-500/10 dark:text-success-500">
              <ShieldCheck className="size-3.5" aria-hidden />
              Card data is masked before storage
            </div>
          </div>
        )}
      </div>

      {state.phase === 'failed' && (
        <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-500">
          {state.error}
        </p>
      )}

      <AlertDialog
        open={pendingConflict !== null}
        onOpenChange={(open) => {
          if (!open) reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing statement?</AlertDialogTitle>
            <AlertDialogDescription>
              A statement for {monthYearLabel} (****
              {pendingConflict?.conflict.cardLast4}) already exists. Replacing
              it keeps the previous version for 90 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking} onClick={() => reset()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={isWorking}
              onClick={(e) => {
                e.preventDefault();
                if (pendingConflict) {
                  start(pendingConflict.file, true);
                }
              }}
            >
              {isWorking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Replacing…
                </>
              ) : (
                'Replace'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
