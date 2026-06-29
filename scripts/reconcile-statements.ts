/**
 * Reconciliation script — verifies migration completeness.
 *
 * Compares every legacy statement against its migrated counterpart and the
 * DynamoDB metadata record. Exits non-zero on any mismatch.
 *
 * Usage:
 *   pnpm reconcile:statements \
 *     --user-sub <cognito-sub> \
 *     --source-prefix statements/ \
 *     --report .migration-private/reconciliation.json
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { StatementSchema } from '@cashight/domain/schemas';
import { aggregate } from '@cashight/domain/aggregations';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReconciliationEntry {
  sourceKey: string;
  destKey: string;
  status: 'ok' | 'missing-dest' | 'sha-mismatch' | 'missing-metadata' | 'data-mismatch' | 'error';
  detail?: string;
}

export interface ReconciliationReport {
  generatedAt: string;
  sub: string;
  bucket: string;
  sourceCount: number;
  destCount: number;
  metadataCount: number;
  entries: ReconciliationEntry[];
  mismatches: number;
  passed: boolean;
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function destKey(sub: string, cardLast4: string, year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  return `users/${sub}/statements/${cardLast4}/${year}/${year}-${mm}.json`;
}

function dynamoSK(cardLast4: string, year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  return `STATEMENT#${year}-${mm}#${cardLast4}`;
}

function parseSourceKey(key: string): { cardLast4: string; year: number; month: number } | null {
  const match = key.match(/^statements\/(\d{4})\/(\d{4})\/(\d{4})-(\d{2})\.json$/);
  if (!match) return null;
  return { cardLast4: match[1], year: Number(match[3]), month: Number(match[4]) };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ── Core reconcile ────────────────────────────────────────────────────────────

export async function reconcile(
  sub: string,
  bucket: string,
  tableName: string,
  s3: S3Client,
  dynamo: DynamoDBDocumentClient,
): Promise<ReconciliationReport> {
  const now = new Date().toISOString();
  const report: ReconciliationReport = {
    generatedAt: now,
    sub,
    bucket,
    sourceCount: 0,
    destCount: 0,
    metadataCount: 0,
    entries: [],
    mismatches: 0,
    passed: false,
  };

  // 1. List all source objects
  const sourceKeys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'statements/', ContinuationToken: token }),
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key) sourceKeys.push(obj.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  report.sourceCount = sourceKeys.length;

  // 2. List all destination objects
  const destKeys = new Set<string>();
  token = undefined;
  do {
    const page: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `users/${sub}/statements/`,
        ContinuationToken: token,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key) destKeys.add(obj.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  report.destCount = destKeys.size;

  // 3. Per-object checks
  for (const sourceKey of sourceKeys) {
    const coords = parseSourceKey(sourceKey);
    if (!coords) {
      report.entries.push({ sourceKey, destKey: '', status: 'error', detail: 'Unparseable source key' });
      report.mismatches++;
      continue;
    }
    const { cardLast4, year, month } = coords;
    const dest = destKey(sub, cardLast4, year, month);
    const entry: ReconciliationEntry = { sourceKey, destKey: dest, status: 'ok' };

    // Check destination exists
    if (!destKeys.has(dest)) {
      entry.status = 'missing-dest';
      entry.detail = `Destination object not found: ${dest}`;
      report.entries.push(entry);
      report.mismatches++;
      continue;
    }

    // Read and compare SHA-256
    try {
      const srcRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
      const srcBytes = await srcRes.Body!.transformToByteArray();
      const srcSha = sha256(srcBytes);

      const dstRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: dest }));
      const dstBytes = await dstRes.Body!.transformToByteArray();
      const dstSha = sha256(dstBytes);

      if (srcSha !== dstSha) {
        entry.status = 'sha-mismatch';
        entry.detail = `SHA-256 mismatch: source=${srcSha.slice(0, 16)}… dest=${dstSha.slice(0, 16)}…`;
        report.entries.push(entry);
        report.mismatches++;
        continue;
      }

      // Validate statement data integrity
      const srcStatement = StatementSchema.parse(JSON.parse(Buffer.from(srcBytes).toString('utf8')));
      const dstStatement = StatementSchema.parse(JSON.parse(Buffer.from(dstBytes).toString('utf8')));

      const dataOk =
        srcStatement.cardLast4 === dstStatement.cardLast4 &&
        srcStatement.statementDate === dstStatement.statementDate &&
        srcStatement.totals.totalSpend === dstStatement.totals.totalSpend &&
        srcStatement.transactions.length === dstStatement.transactions.length;

      if (!dataOk) {
        entry.status = 'data-mismatch';
        entry.detail = 'Statement data fields differ between source and destination';
        report.entries.push(entry);
        report.mismatches++;
        continue;
      }
    } catch (err) {
      entry.status = 'error';
      entry.detail = err instanceof Error ? err.message : String(err);
      report.entries.push(entry);
      report.mismatches++;
      continue;
    }

    // Check DynamoDB metadata record
    const sk = dynamoSK(cardLast4, year, month);
    const dynamoRes = await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${sub}`, SK: sk },
        ConsistentRead: true,
      }),
    );

    if (!dynamoRes.Item) {
      entry.status = 'missing-metadata';
      entry.detail = `DynamoDB record not found: PK=USER#${sub} SK=${sk}`;
      report.entries.push(entry);
      report.mismatches++;
      continue;
    }

    report.metadataCount++;
    report.entries.push(entry);
  }

  // 4. Aggregate parity check — compare monthly aggregates
  if (report.mismatches === 0 && sourceKeys.length > 0) {
    const srcStatements = await Promise.all(
      sourceKeys.map(async (key) => {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const text = await res.Body!.transformToString();
        return StatementSchema.parse(JSON.parse(text));
      }),
    );
    const dstStatements = await Promise.all(
      [...destKeys].map(async (key) => {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const text = await res.Body!.transformToString();
        return StatementSchema.parse(JSON.parse(text));
      }),
    );

    // Build a quick fingerprint: total spend across all statements
    const srcTotal = srcStatements.reduce((s, stmt) => s + stmt.totals.totalSpend, 0);
    const dstTotal = dstStatements.reduce((s, stmt) => s + stmt.totals.totalSpend, 0);

    if (srcTotal !== dstTotal) {
      report.entries.push({
        sourceKey: 'aggregate',
        destKey: 'aggregate',
        status: 'data-mismatch',
        detail: `Aggregate totalSpend mismatch: source=${srcTotal} dest=${dstTotal}`,
      });
      report.mismatches++;
    }
  }

  report.passed = report.mismatches === 0 && report.sourceCount === report.destCount;
  return report;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { sub: string; report: string } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const sub = get('--user-sub');
  const report = get('--report');
  if (!sub) throw new Error('--user-sub <cognito-sub> is required');
  if (!report) throw new Error('--report <path> is required (must be under .migration-private/)');
  const privateRoot = path.resolve(process.cwd(), '.migration-private');
  const resolved = path.resolve(process.cwd(), report);
  if (!resolved.startsWith(`${privateRoot}${path.sep}`) && resolved !== privateRoot) {
    throw new Error('--report path must be under .migration-private/');
  }
  return { sub, report: resolved };
}

async function main(): Promise<void> {
  const bucket = process.env.STATEMENTS_BUCKET;
  const tableName = process.env.TABLE_NAME;
  const region = process.env.STORAGE_REGION ?? process.env.AWS_REGION ?? 'ap-southeast-1';
  if (!bucket) throw new Error('STATEMENTS_BUCKET env var is required');
  if (!tableName) throw new Error('TABLE_NAME env var is required');

  const { sub, report: reportPath } = parseArgs(process.argv.slice(2));

  const s3 = new S3Client({ region });
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  console.log(`Reconciling statements for sub: ${sub}`);
  const result = await reconcile(sub, bucket, tableName, s3, dynamo);

  await mkdir(path.dirname(reportPath), { recursive: true, mode: 0o700 });
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  console.log(`Source objects:   ${result.sourceCount}`);
  console.log(`Dest objects:     ${result.destCount}`);
  console.log(`Metadata records: ${result.metadataCount}`);
  console.log(`Mismatches:       ${result.mismatches}`);
  console.log(`Result:           ${result.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`Report:           ${reportPath}`);

  if (!result.passed) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((err: unknown) => {
    console.error(`Reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
