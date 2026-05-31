/**
 * Vitest suite for lib/parsers/tpbank.ts.
 *
 * Uses the gitignored May 2026 sample PDF as the real-fixture acceptance test.
 * CI skips the fixture-dependent suites because test-pdfs/ is gitignored.
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { parseTPBankStatement } from '../parsers/tpbank';
import type { Statement } from '@/lib/schemas';

const pdfPath = path.resolve(
  __dirname,
  '../../test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf',
);
const hasFixture = fs.existsSync(pdfPath);

// ---------------------------------------------------------------------------
// Unprotected PDF — the optional password arg must not disturb the parse path.
// ---------------------------------------------------------------------------

describe.skipIf(!hasFixture)('parseTPBankStatement — unprotected PDF', () => {
  let stmt: Statement;

  beforeAll(async () => {
    stmt = await parseTPBankStatement(fs.readFileSync(pdfPath));
  });

  it('returns cardLast4 === "9674"', () => {
    expect(stmt.cardLast4).toBe('9674');
  });

  it('returns totals.statementBalance === 37978402', () => {
    expect(stmt.totals.statementBalance).toBe(37_978_402);
  });

  it('returns totals.totalSpend === 26986712', () => {
    expect(stmt.totals.totalSpend).toBe(26_986_712);
  });

  it('returns totals.totalCashback === 519020', () => {
    expect(stmt.totals.totalCashback).toBe(519_020);
  });
});

// An unused password arg (the PDF is not protected, so PasswordException never
// fires) must leave the result identical — proving the retry path is inert when
// it isn't needed.
describe.skipIf(!hasFixture)('parseTPBankStatement — unprotected PDF with unused password', () => {
  it('parses unchanged when a password arg is supplied', async () => {
    const stmt = await parseTPBankStatement(fs.readFileSync(pdfPath), 'some-password');
    expect(stmt.cardLast4).toBe('9674');
    expect(stmt.totals.statementBalance).toBe(37_978_402);
  });
});
