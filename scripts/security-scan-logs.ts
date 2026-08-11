import {
  lstat,
  readFile,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const privacyPatterns = [
  { name: 'PAN-like digit sequence', re: /\b\d{13,19}\b/ },
  { name: '12-digit AWS account ID', re: /\b\d{12}\b/ },
  { name: 'PDF_PASSWORD assignment', re: /\bPDF_PASSWORDS?\s*=/ },
  { name: 'GEMINI_API_KEY assignment', re: /\bGEMINI_API_KEY\s*=/ },
  { name: 'AUTH_SECRET assignment', re: /\bAUTH_SECRET\s*=/ },
  { name: 'raw card number label', re: /\bCard Number\b/i },
  { name: 'invoice-number label', re: /\binvoice\s*(?:number|no\.?|#)\s*[:#-]?/i },
  {
    name: 'bill-to or address heading',
    re: /\b(?:bill(?:ed)?\s+to|billing\s+address|mailing\s+address|street\s+address)\s*:/i,
  },
  {
    name: 'presigned invoice URL',
    re: /https?:\/\/[^\s"']*(?:aws-invoices|X-Amz-(?:Credential|Signature|Security-Token))[^\s"']*/i,
  },
  {
    name: 'prohibited invoice payload key',
    re: /["'](?:billTo|address|invoiceNumber|accountId|accountLabel|rawText)["']\s*:/,
  },
  { name: 'private key block', re: /BEGIN PRIVATE KEY/ },
] as const;

export interface PrivacyFinding {
  file: string;
  pattern: string;
}

const DEFAULT_SCAN_PATHS = ['out', 'test-results', 'playwright-report', '.artifacts/logs'];

function isExcluded(filePath: string, privateFixture?: string): boolean {
  const resolved = path.resolve(filePath);
  return (
    path.extname(resolved).toLowerCase() === '.pdf' ||
    (privateFixture ? resolved === path.resolve(privateFixture) : false)
  );
}

async function collectFiles(target: string, privateFixture?: string): Promise<string[]> {
  if (isExcluded(target, privateFixture)) return [];
  let stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (stats.isSymbolicLink()) return [];
  if (stats.isFile()) return [target];
  if (!stats.isDirectory()) return [];

  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      collectFiles(path.join(target, entry.name), privateFixture),
    ),
  );
  return nested.flat();
}

export async function scanPrivacyArtifacts(
  targets: string[],
  privateFixture = process.env.AWS_INVOICE_FIXTURE,
): Promise<PrivacyFinding[]> {
  const files = (await Promise.all(
    targets.map((target) => collectFiles(target, privateFixture)),
  )).flat();
  const findings: PrivacyFinding[] = [];

  for (const file of files) {
    const buffer = await readFile(file);
    if (buffer.includes(0)) continue;
    const text = buffer.toString('utf8');
    const isBundledJavaScript = /\.(?:js|mjs|cjs|map)$/i.test(file);
    for (const pattern of privacyPatterns) {
      // Minified dependency bundles contain numeric constants such as
      // Number.MAX_SAFE_INTEGER. Sensitive numbers in JavaScript are still
      // caught by their prohibited JSON keys and identity labels.
      if (
        isBundledJavaScript &&
        ['PAN-like digit sequence', '12-digit AWS account ID'].includes(pattern.name)
      ) {
        continue;
      }
      if (pattern.re.test(text)) {
        findings.push({ file, pattern: pattern.name });
      }
    }
  }
  return findings;
}

async function main() {
  const requested = process.argv.slice(2);
  const targets = requested.length > 0 ? requested : DEFAULT_SCAN_PATHS;
  const findings = await scanPrivacyArtifacts(targets);

  if (findings.length > 0) {
    console.error('Security artifact scan failed:');
    for (const finding of findings) {
      console.error(`- ${finding.pattern} in ${finding.file}`);
    }
    process.exitCode = 1;
    return;
  }

  console.info(`Security artifact scan passed (${targets.length} target${targets.length === 1 ? '' : 's'}).`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error: unknown) => {
    console.error(
      `Security artifact scan failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
