'use client';

import { useDropzone } from 'react-dropzone';
import { useState } from 'react';
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
    <div>
      <div
        {...getRootProps()}
        className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:bg-muted/50 transition"
      >
        <input {...getInputProps()} />
        {loading ? (
          <p className="text-muted-foreground">Parsing…</p>
        ) : isDragActive ? (
          <p className="text-muted-foreground">Drop the PDF here</p>
        ) : (
          <p className="text-muted-foreground">
            Drag a TPBank statement PDF here, or click to select
          </p>
        )}
      </div>
      {error && <p className="text-destructive text-sm mt-2">{error}</p>}

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
              {loading ? 'Replacing…' : 'Replace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
