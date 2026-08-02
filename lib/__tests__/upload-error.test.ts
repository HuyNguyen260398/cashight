import { describe, expect, it } from 'vitest';

import {
  getUploadErrorMessage,
  uploadErrorMessage,
} from '@cashight/domain/upload-error';

describe('getUploadErrorMessage', () => {
  it('uses a JSON error body when the API returns one', async () => {
    const response = new Response(JSON.stringify({ error: 'Failed to save statement' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });

    await expect(getUploadErrorMessage(response)).resolves.toBe('Failed to save statement');
  });

  it('does not throw when the server returns a non-JSON 500 body', async () => {
    const response = new Response('<html>Internal Server Error</html>', {
      status: 500,
      headers: { 'content-type': 'text/html' },
    });

    await expect(getUploadErrorMessage(response)).resolves.toBe('Upload failed (500)');
  });
});

describe('uploadErrorMessage', () => {
  it('explains an unrecognised bank', () => {
    expect(uploadErrorMessage('UNSUPPORTED_BANK')).toMatch(/TPBank and VIB/);
  });

  it('explains a failed decryption', () => {
    expect(uploadErrorMessage('WRONG_PASSWORD')).toMatch(/password/i);
  });

  it('falls back for an unknown code', () => {
    expect(uploadErrorMessage('SOMETHING_NEW')).toBe('Processing failed');
  });

  it('falls back when no code is given', () => {
    expect(uploadErrorMessage(undefined)).toBe('Processing failed');
  });
});
