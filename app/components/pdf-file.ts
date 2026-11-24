export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/**
 * The one PDF to upload from a drop/selection, or the message explaining why
 * it was rejected. Shared by the statement and invoice upload areas.
 */
export function pickPdf(files: readonly File[]): { file: File } | { error: string } | null {
  const file = files[0];
  if (!file) return null;
  if (files.length > 1) return { error: 'Upload one PDF at a time.' };
  if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
    return { error: 'Only PDF files are accepted.' };
  }
  if (file.size > MAX_PDF_BYTES) return { error: 'File is too large (max 5 MB).' };
  return { file };
}
