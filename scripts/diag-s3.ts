/**
 * Standalone S3 diagnostic — run in the SAME terminal you launch `pnpm dev` from:
 *   pnpm tsx scripts/diag-s3.ts
 *
 * It loads .env.local the way Next does, then checks, in order:
 *   1) env vars present, 2) AWS credentials resolve, 3) an S3 write works.
 * Whichever step prints FAILED is the real cause of the upload 500.
 */
import { readFileSync } from 'fs';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// Load .env.local (tsx doesn't auto-load it; Next does at startup).
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch {
  console.log('WARN: could not read .env.local from', process.cwd());
}

async function main() {
  const region = process.env.AWS_REGION;
  const Bucket = process.env.STATEMENTS_BUCKET;
  console.log('cwd              :', process.cwd());
  console.log('AWS_REGION       :', region ?? '(unset)');
  console.log('STATEMENTS_BUCKET:', Bucket ?? '(unset)');
  console.log('PATH has aws?    :', (process.env.PATH ?? '').split(':').some((p) => p.endsWith('/bin')) ? 'PATH set' : 'PATH suspicious');
  if (!region || !Bucket) {
    console.log('STEP 1 FAILED: env vars missing — .env.local not loaded into this shell.');
    return;
  }

  const s3 = new S3Client({ region });

  // Step 2: resolve credentials explicitly (surfaces credential_process / session errors).
  try {
    const creds = await s3.config.credentials();
    console.log(
      'STEP 2 OK: creds resolved (accessKeyId …' +
        (creds.accessKeyId ?? '').slice(-4) +
        ', expires ' + (creds.expiration ?? 'n/a') + ')',
    );
  } catch (e) {
    const err = e as { name?: string; message?: string };
    console.log('STEP 2 FAILED (credentials):', err.name, '-', err.message);
    return;
  }

  // Step 3: actual S3 write + cleanup.
  const Key = 'statements/0000/2099/2099-12.json';
  try {
    await s3.send(new PutObjectCommand({ Bucket, Key, Body: '{}', ContentType: 'application/json' }));
    await s3.send(new DeleteObjectCommand({ Bucket, Key }));
    console.log('STEP 3 OK: S3 PUT+DELETE succeeded — storage works in this shell.');
  } catch (e) {
    const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    console.log(
      'STEP 3 FAILED (S3):',
      err.name,
      '-',
      err.message,
      '| http',
      err.$metadata?.httpStatusCode,
    );
  }
}

main();
