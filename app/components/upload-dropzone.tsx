'use client';

import { useDropzone } from 'react-dropzone';
import { useState } from 'react';
import type { Statement } from '@/lib/schemas';

export function UploadDropzone({ onParsed }: { onParsed: (s: Statement) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    disabled: loading,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
    onDrop: async (acceptedFiles) => {
      if (acceptedFiles.length === 0) return;
      setLoading(true);
      setError(null);
      const fd = new FormData();
      fd.append('file', acceptedFiles[0]);
      try {
        const res = await fetch('/api/parse', { method: 'POST', body: fd });
        if (!res.ok) {
          const body = await res.json();
          setError((body as { error?: string }).error ?? 'Upload failed');
        } else {
          onParsed(await res.json() as Statement);
        }
      } catch {
        setError('Network error — please try again.');
      } finally {
        setLoading(false);
      }
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
    </div>
  );
}
