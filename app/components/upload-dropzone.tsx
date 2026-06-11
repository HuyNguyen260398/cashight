'use client';

import { useDropzone } from 'react-dropzone';
import { useState } from 'react';
import { FileUp, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { Statement } from '@/lib/schemas';
import { getUploadErrorMessage } from '@/lib/upload-error';
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

type PendingConflict = {
  file: File;
  cardLast4: string;
  year: number;
  month: number;
};

export function UploadDropzone({ onParsed }: { onParsed: (s: Statement) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);

  async function uploadFile(file: File, force: boolean) {
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/parse' + (force ? '?force=true' : ''), {
        method: 'POST',
        body: fd,
      });
      if (res.ok) {
        const statement = (await res.json()) as Statement;
        toast.success('Statement saved');
        setPendingConflict(null);
        onParsed(statement);
      } else if (res.status === 409) {
        const body = (await res.json()) as {
          cardLast4: string;
          year: number;
          month: number;
        };
        setPendingConflict({
          file,
          cardLast4: body.cardLast4,
          year: body.year,
          month: body.month,
        });
      } else {
        setError(await getUploadErrorMessage(res));
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    disabled: loading,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length === 0) return;
      void uploadFile(acceptedFiles[0], false);
    },
    onDropRejected: (fileRejections) => {
      const firstError = fileRejections[0]?.errors[0];
      if (!firstError) {
        setError('File rejected.');
        return;
      }
      switch (firstError.code) {
        case 'file-invalid-type':
          setError('Only PDF files are accepted.');
          break;
        case 'file-too-large':
          setError('File is too large (max 5 MB).');
          break;
        default:
          setError(firstError.message);
      }
    },
  });

  const monthYearLabel = pendingConflict
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
        new Date(pendingConflict.year, pendingConflict.month - 1),
      )
    : '';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div
        {...getRootProps()}
        className="cursor-pointer rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center transition hover:border-brand-300 hover:bg-brand-25 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800 dark:hover:bg-brand-500/10 md:p-12"
      >
        <input {...getInputProps()} />
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400">
            <Loader2 className="size-9 animate-spin text-brand-500" />
            <p className="text-sm font-medium">Parsing and saving to S3...</p>
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
      {error && (
        <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-500">
          {error}
        </p>
      )}

      <AlertDialog
        open={pendingConflict !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConflict(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing statement?</AlertDialogTitle>
            <AlertDialogDescription>
              A statement for {monthYearLabel} (****{pendingConflict?.cardLast4}) already
              exists. Replacing it keeps the previous version for 90 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                if (pendingConflict) void uploadFile(pendingConflict.file, true);
              }}
            >
              {loading ? (
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
