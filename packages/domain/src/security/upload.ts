import { Buffer } from 'node:buffer';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function isPdfMagicBytes(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

export async function validatePdfUpload(
  file: File,
): Promise<{ buffer: Buffer } | { response: Response }> {
  if (file.type !== 'application/pdf') {
    return {
      response: Response.json(
        { error: 'Only PDF files are accepted.' },
        { status: 415 },
      ),
    };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      response: Response.json(
        { error: 'File is too large (max 5 MB).' },
        { status: 413 },
      ),
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.length > MAX_UPLOAD_BYTES) {
    return {
      response: Response.json(
        { error: 'File is too large (max 5 MB).' },
        { status: 413 },
      ),
    };
  }

  if (!isPdfMagicBytes(buffer)) {
    return {
      response: Response.json(
        { error: 'Only valid PDF files are accepted.' },
        { status: 415 },
      ),
    };
  }

  return { buffer };
}
