'use client';

import { useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
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

  const dropzone = useDropzone({
    disabled: isWorking,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
    onDrop: ([file]) => file && start(file),
    onDropRejected: (rejections) => {
      const code = rejections[0]?.errors[0]?.code;
      toast.error(
        code === 'file-too-large'
          ? 'File is too large (max 5 MB).'
          : 'Only PDF files are accepted.',
      );
    },
  });
  const conflict = state.phase === 'conflict' ? state : null;
  const month = conflict
    ? formatInvoiceMonth(
        `${conflict.conflict.year}-${String(conflict.conflict.month).padStart(2, '0')}`,
      )
    : '';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div {...dropzone.getRootProps()} className="cursor-pointer rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-7 text-center transition-colors duration-200 hover:border-brand-300 hover:bg-brand-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800 dark:hover:bg-brand-500/10" aria-label="Upload AWS invoice PDF">
        <input {...dropzone.getInputProps()} />
        {isWorking ? <div className="flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400"><Loader2 className="size-9 animate-spin text-brand-500" aria-hidden /><p className="text-sm font-medium" role="status">{state.message}</p></div> : <div className="flex flex-col items-center"><div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"><FileUp className="size-6" aria-hidden /></div><p className="font-semibold text-gray-900 dark:text-white/90">Upload an AWS consolidated invoice</p><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Drop or select one PDF up to 5 MB</p><span className="mt-4 inline-flex items-center gap-2 rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-700 dark:bg-success-500/10 dark:text-success-500"><ShieldCheck className="size-3.5" aria-hidden />Private header and account data are removed</span></div>}
      </div>
      {state.phase === 'failed' && <p role="alert" className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-500">{state.error}</p>}
      <AlertDialog open={conflict !== null} onOpenChange={(open) => !open && reset()}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Replace existing invoice?</AlertDialogTitle><AlertDialogDescription>An invoice for {month} already exists. Replacing it preserves the previous S3 version for 90 days.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={reset}>Cancel</AlertDialogCancel><AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={(event) => { event.preventDefault(); if (conflict) start(conflict.file, true); }}>Replace invoice</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
