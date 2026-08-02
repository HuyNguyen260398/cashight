/**
 * Plain-text PDF extraction shared by bank detection and the TPBank parser.
 *
 * Tries the document unprotected first, then each candidate password in order.
 * Candidates come from the PDF password secret, which holds one password per
 * supported bank; the bank cannot be known before the document is decrypted,
 * so every candidate is tried rather than selected.
 *
 * Passwords are never logged.
 */

// MUST precede the `pdf-parse` import — see ../pdf-dom-polyfill.ts.
import '../pdf-dom-polyfill';
import { PDFParse } from 'pdf-parse';

export interface ExtractedPdfText {
  text: string;
  /** The password that worked, or undefined when none was needed. */
  password?: string;
}

function isPasswordException(err: unknown): boolean {
  return err instanceof Error && err.name === 'PasswordException';
}

/**
 * Extract raw text once.
 *
 * A fresh Uint8Array is allocated per attempt on purpose: pdf.js TRANSFERS the
 * typed array to its worker and detaches it, so one array cannot be reused
 * across two PDFParse instances.
 */
async function extractOnce(buffer: Buffer, password?: string): Promise<string> {
  const data = new Uint8Array(buffer);
  const parser = new PDFParse(password ? { data, password } : { data });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export async function extractPdfText(
  buffer: Buffer,
  passwords: string[] = [],
): Promise<ExtractedPdfText> {
  try {
    return { text: await extractOnce(buffer) };
  } catch (err) {
    if (!isPasswordException(err)) throw err;

    let lastError = err;
    for (const password of passwords) {
      if (!password) continue;
      try {
        return { text: await extractOnce(buffer, password), password };
      } catch (retryError) {
        if (!isPasswordException(retryError)) throw retryError;
        lastError = retryError;
      }
    }
    throw lastError;
  }
}
