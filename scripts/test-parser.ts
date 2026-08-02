/**
 * CLI verification for the statement PDF parsers. This IS the acceptance test
 * for Step 02. Parses the canonical fixtures and hard-asserts the known
 * numbers, transaction counts, categorization, and PCI hygiene.
 *
 * TPBank (May 2026) always runs; VIB (July 2026) runs when its fixture is
 * present. Both fixtures live in the gitignored test-pdfs/.
 *
 * Run: pnpm tsx scripts/test-parser.ts
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { parseTPBankStatement } from '../packages/domain/src/parsers/tpbank';
import { parseVIBStatement } from '../packages/domain/src/parsers/vib';

const FIXTURE = path.join(
  process.cwd(),
  'test-pdfs',
  'VC_sao_ke_the_tin_dung_05_2026_9674.pdf',
);

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  const buffer = await fs.readFile(FIXTURE);
  const statement = await parseTPBankStatement(buffer);

  console.log('\n--- Parsed statement ---');
  console.log(JSON.stringify(statement, null, 2));

  console.log('\n--- Totals & header ---');
  check(
    'statementBalance === 37978402',
    statement.totals.statementBalance === 37978402,
    String(statement.totals.statementBalance),
  );
  check(
    'totalSpend === 26986712',
    statement.totals.totalSpend === 26986712,
    String(statement.totals.totalSpend),
  );
  check(
    'totalCashback === 519020',
    statement.totals.totalCashback === 519020,
    String(statement.totals.totalCashback),
  );
  check(
    'totalInstallments === 10749850',
    statement.totals.totalInstallments === 10749850,
    String(statement.totals.totalInstallments),
  );
  check(
    'totalFeesAndInterest === 760860',
    statement.totals.totalFeesAndInterest === 760860,
    String(statement.totals.totalFeesAndInterest),
  );
  check(
    'previousBalance === 17184741',
    statement.totals.previousBalance === 17184741,
    String(statement.totals.previousBalance),
  );
  check(
    'minimumPayment === 11618209',
    statement.totals.minimumPayment === 11618209,
    String(statement.totals.minimumPayment),
  );
  check('cardLast4 === "9674"', statement.cardLast4 === '9674', statement.cardLast4);
  check(
    'creditLimit === 103000000',
    statement.creditLimit === 103000000,
    String(statement.creditLimit),
  );

  console.log('\n--- Transactions ---');
  check(
    'transactions.length === 41',
    statement.transactions.length === 41,
    String(statement.transactions.length),
  );

  // Reconciliation: prev - payment + spend + installments - cashback + fees = balance.
  const payment = statement.transactions
    .filter((t) => t.category === 'Payment')
    .reduce((s, t) => s + Math.abs(t.amountVnd), 0);
  const reconciled =
    statement.totals.previousBalance -
    payment +
    statement.totals.totalSpend +
    statement.totals.totalInstallments -
    statement.totals.totalCashback +
    statement.totals.totalFeesAndInterest;
  check(
    'reconciliation === statementBalance',
    reconciled === statement.totals.statementBalance,
    `${reconciled} vs ${statement.totals.statementBalance}`,
  );

  console.log('\n--- Categorization (known merchants must not be "Other") ---');
  const findCat = (needle: RegExp): string | undefined =>
    statement.transactions.find((t) => needle.test(t.description))?.category;
  const known: Array<[string, RegExp]> = [
    ['Shopee', /shopee/i],
    ['AWS', /^aws$/i],
    ['Apple', /apple/i],
    ['Foody', /foody/i],
    ['Agoda', /agoda/i],
    ['Steam', /steam/i],
  ];
  for (const [name, re] of known) {
    const cat = findCat(re);
    check(`${name} categorized (not Other)`, !!cat && cat !== 'Other', cat ?? 'NOT FOUND');
  }

  console.log('\n--- PCI hygiene ---');
  const serialized = JSON.stringify(statement);
  check("does NOT contain BIN '498796'", !serialized.includes('498796'));
  check("does NOT contain mask 'xxxxxx'", !serialized.includes('xxxxxx'));
  // No run of 7+ consecutive digits except legitimate VND amounts. The largest
  // single VND amount here is 9 digits (103000000 credit limit / 48090000), so
  // we instead assert the specific PAN fragments are absent (covered above) and
  // that no token resembling the full 16-digit-ish PAN survives.
  check(
    'no 11+ digit run (no full PAN)',
    !/\d{11,}/.test(serialized),
    (serialized.match(/\d{11,}/) ?? ['n/a'])[0],
  );

  // --- VIB (July 2026) ---
  const vibFixture = path.join(
    process.cwd(),
    'test-pdfs',
    'vib_saoke_07_2026_4550.pdf',
  );
  if (existsSync(vibFixture)) {
    console.log('\n--- VIB (July 2026) ---');
    const vib = await parseVIBStatement(
      await fs.readFile(vibFixture),
      process.env.VIB_PDF_PASSWORD,
    );
    check('bank === "VIB"', vib.bank === 'VIB', vib.bank);
    check('cardLast4 === "4550"', vib.cardLast4 === '4550', vib.cardLast4);
    check(
      'statementDate === "2026-07-25"',
      vib.statementDate === '2026-07-25',
      vib.statementDate,
    );
    check(
      'paymentDueDate === "2026-08-10"',
      vib.paymentDueDate === '2026-08-10',
      vib.paymentDueDate,
    );
    check(
      'creditLimit === 124000000',
      vib.creditLimit === 124_000_000,
      String(vib.creditLimit),
    );
    check(
      'statementBalance === 5591567',
      vib.totals.statementBalance === 5_591_567,
      String(vib.totals.statementBalance),
    );
    check(
      'minimumPayment === 5582360',
      vib.totals.minimumPayment === 5_582_360,
      String(vib.totals.minimumPayment),
    );
    check(
      'totalSpend === 0',
      vib.totals.totalSpend === 0,
      String(vib.totals.totalSpend),
    );
    check(
      'totalInstallments === 5581667',
      vib.totals.totalInstallments === 5_581_667,
      String(vib.totals.totalInstallments),
    );
    check(
      'totalFeesAndInterest === 9900',
      vib.totals.totalFeesAndInterest === 9_900,
      String(vib.totals.totalFeesAndInterest),
    );
    check(
      'transactions.length === 3',
      vib.transactions.length === 3,
      String(vib.transactions.length),
    );
    const vibSerialized = JSON.stringify(vib);
    check(
      'no PAN or cardholder name in output',
      !/\d{6}[x*]{6}\d{4}/i.test(vibSerialized) &&
        !vibSerialized.includes('NGUYEN') &&
        vib.transactions.every((t) => !/\d{9,}/.test(t.description)),
    );
  } else {
    console.log('\n--- VIB: fixture absent, skipped ---');
  }

  console.log('');
  if (failures > 0) {
    console.error(`${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
