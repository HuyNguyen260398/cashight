import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { parseTPBankStatement } from '@cashight/domain/parsers/tpbank';

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  'test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf',
);

const EXPECTED = {
  cardLast4: '9674',
  statementBalance: 37978402,
  totalSpend: 26986712,
  totalCashback: 519020,
  transactionCount: 41,
} as const;

describe.skipIf(!existsSync(FIXTURE_PATH))(
  'parser-worker parity (requires local fixture PDF)',
  () => {
    it('produces correct statement values from canonical fixture', async () => {
      const buffer = await readFile(FIXTURE_PATH);
      const statement = await parseTPBankStatement(buffer);

      expect(statement.cardLast4).toBe(EXPECTED.cardLast4);
      expect(statement.totals.statementBalance).toBe(EXPECTED.statementBalance);
      expect(statement.totals.totalSpend).toBe(EXPECTED.totalSpend);
      expect(statement.totals.totalCashback).toBe(EXPECTED.totalCashback);
      expect(statement.transactions.length).toBe(EXPECTED.transactionCount);
    });

    it('masks the full PAN — only cardLast4 survives', async () => {
      const buffer = await readFile(FIXTURE_PATH);
      const statement = await parseTPBankStatement(buffer);
      const serialized = JSON.stringify(statement);

      // Full 16-digit PAN pattern must not appear
      expect(serialized).not.toMatch(/\d{13,19}/);
      // cardLast4 is present and correct
      expect(statement.cardLast4).toBe('9674');
    });
  },
);
