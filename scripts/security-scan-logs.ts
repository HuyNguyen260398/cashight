import { readFileSync } from 'node:fs';

const path = process.argv[2];

if (!path) {
  console.error('Usage: pnpm security:scan-logs <log-file>');
  process.exit(2);
}

const text = readFileSync(path, 'utf8');

const patterns = [
  { name: 'PAN-like digit sequence', re: /\b\d{13,19}\b/ },
  { name: 'PDF_PASSWORD assignment', re: /\bPDF_PASSWORD\s*=/ },
  { name: 'GEMINI_API_KEY assignment', re: /\bGEMINI_API_KEY\s*=/ },
  { name: 'AUTH_SECRET assignment', re: /\bAUTH_SECRET\s*=/ },
  { name: 'raw card number label', re: /\bCard Number\b/i },
  { name: 'private key block', re: /BEGIN PRIVATE KEY/ },
];

const findings = patterns.filter((pattern) => pattern.re.test(text));

if (findings.length > 0) {
  console.error('Security log scan failed:');
  for (const finding of findings) {
    console.error(`- ${finding.name}`);
  }
  process.exit(1);
}

console.info('Security log scan passed.');
