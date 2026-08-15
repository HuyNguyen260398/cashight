import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scanPrivacyArtifacts } from '../security-scan-logs';

describe('security artifact scanning', () => {
  it('detects AWS invoice identifiers, headings, URLs, and prohibited payload keys', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cashight-privacy-'));
    const samples = {
      'account.log': 'linked account 123456789012',
      'invoice.log': 'Invoice number: INV-PRIVATE',
      'address.log': 'Bill to: Private Customer',
      'url.log': 'https://bucket.s3.amazonaws.com/uploads/aws-invoices/primary/file.pdf?X-Amz-Signature=secret',
      'payload.json': JSON.stringify({ rawText: 'private extraction' }),
    };
    await Promise.all(
      Object.entries(samples).map(([name, value]) =>
        writeFile(path.join(root, name), value),
      ),
    );

    const findings = await scanPrivacyArtifacts([root]);

    expect(findings.map((finding) => finding.pattern).sort()).toEqual([
      '12-digit AWS account ID',
      'bill-to or address heading',
      'invoice-number label',
      'presigned invoice URL',
      'prohibited invoice payload key',
    ]);
  });

  it('scans nested build and test output while excluding PDFs and the private fixture', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cashight-privacy-'));
    const nested = path.join(root, 'out', 'nested');
    const privateFixture = path.join(root, 'private-aws-invoice.pdf');
    await mkdir(nested, { recursive: true });
    await writeFile(
      path.join(nested, 'safe.js'),
      'const safeInteger = 9007199254740991; const masked = "ending 0001";',
    );
    await writeFile(privateFixture, 'Bill to: Must not scan source fixture');

    await expect(
      scanPrivacyArtifacts([path.join(root, 'out'), privateFixture], privateFixture),
    ).resolves.toEqual([]);
  });
});
