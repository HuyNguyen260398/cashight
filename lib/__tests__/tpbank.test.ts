/**
 * Vitest suite for @cashight/domain/parsers/tpbank.
 *
 * Uses the gitignored May 2026 sample PDF as the real-fixture acceptance test.
 * CI skips the fixture-dependent suites because test-pdfs/ is gitignored.
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { parseTPBankStatement } from '@cashight/domain/parsers/tpbank';
import type { Statement } from '@cashight/domain/schemas';

const pdfPath = path.resolve(
  __dirname,
  '../../test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf',
);
const hasFixture = fs.existsSync(pdfPath);

// A gitignored, password-protected sample exercises the decrypt-and-retry path.
// Both the file and the password (PDF_PASSWORD env var, or .env.local) are local
// only, so CI skips this suite.
const protectedPdfPath = path.resolve(__dirname, '../../test-pdfs/140827763.pdf');

function readPdfPassword(): string | undefined {
  if (process.env.PDF_PASSWORD) return process.env.PDF_PASSWORD;
  const envLocal = path.resolve(__dirname, '../../.env.local');
  if (!fs.existsSync(envLocal)) return undefined;
  const m = fs.readFileSync(envLocal, 'utf8').match(/^PDF_PASSWORD=(.+)$/m);
  return m?.[1].trim().replace(/^["']|["']$/g, '') || undefined;
}

const pdfPassword = readPdfPassword();
const canTestProtected = fs.existsSync(protectedPdfPath) && !!pdfPassword;

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

// Regression: the retry path must NOT reuse the Uint8Array from the first
// (unprotected) attempt — pdf.js transfers ownership and detaches it, so reusing
// it throws "DataCloneError: Cannot transfer object of unsupported type".
describe.skipIf(!canTestProtected)('parseTPBankStatement — password-protected PDF', () => {
  it('decrypts and parses with the password', async () => {
    const stmt = await parseTPBankStatement(fs.readFileSync(protectedPdfPath), pdfPassword);
    expect(stmt.cardLast4).toMatch(/^\d{4}$/);
    expect(stmt.transactions.length).toBeGreaterThan(0);
  });
});
