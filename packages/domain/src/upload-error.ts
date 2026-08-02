export async function getUploadErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.length > 0) return body.error;
    } catch {
      // Fall through to status-based fallback below.
    }
  }

  return `Upload failed (${response.status})`;
}

/**
 * User-facing text for the terminal error codes the parser worker can set.
 * Codes not listed here fall back to a generic message rather than being shown
 * raw — an error code is not a sentence.
 */
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  UNSUPPORTED_BANK:
    "We couldn't recognise this statement's bank. Cashight supports TPBank and VIB.",
  WRONG_PASSWORD:
    'This PDF is password-protected and none of the configured passwords unlocked it.',
  INVALID_PDF: "That file doesn't look like a PDF.",
  CHECKSUM_MISMATCH:
    'The uploaded file did not match its checksum. Please try uploading it again.',
  PARSE_ERROR:
    "We couldn't read this statement. Please check it is an unmodified bank statement PDF.",
};

export function uploadErrorMessage(code: string | undefined): string {
  if (!code) return 'Processing failed';
  return UPLOAD_ERROR_MESSAGES[code] ?? 'Processing failed';
}
