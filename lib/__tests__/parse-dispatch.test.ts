import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { UnsupportedBankError, parseStatementPdf } from '@cashight/domain/parsers';

const tpbPath = path.resolve(
  __dirname,
  '../../test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf',
);
const vibPath = path.resolve(__dirname, '../../test-pdfs/vib_saoke_07_2026_4550.pdf');

describe('UnsupportedBankError', () => {
  it('carries a stable name so callers can branch on it', () => {
    expect(new UnsupportedBankError().name).toBe('UnsupportedBankError');
  });
});

describe('parseStatementPdf', () => {
  it('rejects a non-statement PDF with UnsupportedBankError', async () => {
    // A minimal one-page PDF containing the word "Hello".
    const minimalPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 20 100 Td (Hello) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>',
      'latin1',
    );
    await expect(parseStatementPdf(minimalPdf, [])).rejects.toThrow(
      UnsupportedBankError,
    );
  });

  it.skipIf(!fs.existsSync(tpbPath))(
    'routes a TPBank PDF to the TPBank parser',
    async () => {
      const stmt = await parseStatementPdf(fs.readFileSync(tpbPath), []);
      expect(stmt.bank).toBe('TPBank');
      expect(stmt.cardLast4).toBe('9674');
    },
  );

  it.skipIf(!fs.existsSync(vibPath))(
    'routes a VIB PDF to the VIB parser using a candidate password',
    async () => {
      const stmt = await parseStatementPdf(fs.readFileSync(vibPath), [
        'wrong-password',
        '26034550',
      ]);
      expect(stmt.bank).toBe('VIB');
      expect(stmt.cardLast4).toBe('4550');
    },
  );
});
