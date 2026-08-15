import type { AwsInvoice } from '../../aws-invoices';
import { extractPdfLayout, type LayoutPage } from '../pdf-layout';
import {
  KNOWN_AWS_INVOICE_PARSER_ID,
  KNOWN_AWS_INVOICE_PARSER_VERSION,
  knownAwsInvoiceParser,
  type AwsInvoiceParser,
  type ExtractedAwsInvoiceDocument,
} from './known-layout';

export { InvoiceTotalMismatchError } from './fields';
export {
  KNOWN_AWS_INVOICE_PARSER_ID,
  KNOWN_AWS_INVOICE_PARSER_VERSION,
  knownAwsInvoiceParser,
};
export type { AwsInvoiceParser, ExtractedAwsInvoiceDocument };

export class UnsupportedAwsInvoiceError extends Error {
  readonly code = 'UNSUPPORTED_AWS_INVOICE' as const;

  constructor() {
    super('The AWS invoice layout is unsupported.');
    this.name = 'UnsupportedAwsInvoiceError';
  }
}

const parsers: readonly AwsInvoiceParser[] = [knownAwsInvoiceParser];

export function parseAwsInvoiceDocument(document: {
  pages: LayoutPage[];
  sha256: string;
  uploadedAt: string;
}): AwsInvoice {
  const extracted: ExtractedAwsInvoiceDocument = { pages: document.pages };
  const parser = parsers.find((candidate) => candidate.canParse(extracted));
  if (!parser) throw new UnsupportedAwsInvoiceError();
  return parser.parse(document);
}

export async function parseAwsInvoicePdf(
  buffer: Buffer,
  source: { sha256: string; uploadedAt: string },
): Promise<AwsInvoice> {
  const pages = await extractPdfLayout(buffer);
  return parseAwsInvoiceDocument({ pages, ...source });
}
