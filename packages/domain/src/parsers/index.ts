/**
 * Entry point for the upload parse path: extract text once, identify the bank,
 * route to that bank's parser.
 *
 * The VIB parser re-opens the PDF to read coordinates. That second pass is
 * deliberate — it keeps the TPBank parser on exactly the `pdf-parse` text it
 * was verified against, and the working password is threaded through so the
 * candidate list is not retried.
 */

import { detectBank } from '../banks';
import type { Statement } from '../schemas';
import { extractPdfText } from './pdf-text';
import { parseTPBankStatementFromText } from './tpbank';
import { parseVIBStatement } from './vib';

export class UnsupportedBankError extends Error {
  constructor() {
    super('Unrecognised statement — no supported bank matched');
    this.name = 'UnsupportedBankError';
  }
}

export async function parseStatementPdf(
  buffer: Buffer,
  passwords: string[] = [],
): Promise<Statement> {
  const { text, password } = await extractPdfText(buffer, passwords);
  const bank = detectBank(text);

  switch (bank) {
    case 'TPBank':
      return parseTPBankStatementFromText(text);
    case 'VIB':
      return parseVIBStatement(buffer, password);
    default:
      throw new UnsupportedBankError();
  }
}
