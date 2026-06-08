import { describe, expect, it } from 'vitest';

import {
  MAX_UPLOAD_BYTES,
  isPdfMagicBytes,
  validatePdfUpload,
} from '@/lib/security/upload';

describe('PDF upload validation', () => {
  it('accepts PDF magic bytes', () => {
    expect(isPdfMagicBytes(Buffer.from('%PDF-1.7\n'))).toBe(true);
  });

  it('rejects MIME spoofing before parsing', async () => {
    const file = new File([Buffer.from('%PDF-1.7\n')], 'statement.pdf', {
      type: 'text/plain',
    });

    const result = await validatePdfUpload(file);

    expect('response' in result ? result.response.status : 0).toBe(415);
  });

  it('rejects oversized files', async () => {
    const file = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.pdf', {
      type: 'application/pdf',
    });

    const result = await validatePdfUpload(file);

    expect('response' in result ? result.response.status : 0).toBe(413);
  });

  it('accepts valid PDF uploads', async () => {
    const file = new File([Buffer.from('%PDF-1.7\nbody')], 'statement.pdf', {
      type: 'application/pdf',
    });

    const result = await validatePdfUpload(file);

    expect('buffer' in result).toBe(true);
  });

  it('rejects non-PDF magic bytes', async () => {
    const file = new File([Buffer.from('not a pdf')], 'statement.pdf', {
      type: 'application/pdf',
    });

    const result = await validatePdfUpload(file);

    expect('response' in result ? result.response.status : 0).toBe(415);
  });
});
