/**
 * Statement migration script.
 *
 * Copies legacy S3 statement objects (statements/{cardLast4}/{year}/{year}-{mm}.json)
 * to the user-prefixed path (users/{sub}/statements/...) and writes DynamoDB metadata
 * records. Never deletes source objects. Idempotent: re-running is safe.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-statements.ts \
 *     --user-sub <cognito-sub> \
 *     --source-prefix statements/ \
 *     --report .migration-private/statement-migration.json \
 *     --dry-run
 *
 *   # After reviewing the report, apply:
 *   pnpm migrate:statements \
 *     --user-sub <cognito-sub> \
 *     --source-prefix statements/ \
 *     --report .migration-private/statement-migration.json \
 *     --apply
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { StatementSchema } from '@cashight/domain/schemas';
import { putStatementMetadata } from '../backend/shared/metadata';
import { getAuthorizedUser, parseAuthorizedUserRecord } from '../backend/shared/metadata';

// ── Public types ──────────────────────────────────────────────────────────────

export interface MigrationEntry {
  sourceKey: string;
  destKey: string;
  sha256?: string;
  statementId?: string;
  outcome:
    | 'would-copy'
    | 'copied'
    | 'already-migrated'
    | 'conflict'
    | 'error';
  errorDetail?: string;
}

export interface MigrationReport {
  generatedAt: string;
  mode: 'dry-run' | 'apply';
  sub: string;
  bucket: string;
  planned: number;
  copied: number;
  skipped: number;
  conflicts: number;
  abortReason?: string;
  entries: MigrationEntry[];
  errors: Array<{ key: string; reason: string }>;
}

export interface SourceObjectRef {
  key: string;
  size: number;
}

export interface DestinationMeta {
  sha256: string;
}

export interface MigrationDependencies {
  listSourceObjects(prefix: string): Promise<SourceObjectRef[]>;
  getObject(bucket: string, key: string): Promise<Buffer>;
  headObject(bucket: string, key: string): Promise<DestinationMeta | null>;
  copyObject(bucket: string, sourceKey: string, destKey: string): Promise<void>;
  getAuthzRecord(tableName: string, sub: string): Promise<unknown>;
  putStatementMetadata(tableName: string, record: unknown): Promise<void>;
}

export interface MigrationContext {
  sub: string;
  sourcePrefix: string;
  bucket: string;
  tableName: string;
}

export interface MigrationOptions {
  dryRun: boolean;
}

export interface PlanEntry {
  sourceKey: string;
  destKey: string;
}

// ── Key derivation ────────────────────────────────────────────────────────────

function destKey(sub: string, cardLast4: string, year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  return `users/${sub}/statements/${cardLast4}/${year}/${year}-${mm}.json`;
}

function statementId(cardLast4: string, year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  return `${year}-${mm}-${cardLast4}`;
}

function dynamoSK(cardLast4: string, year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  return `STATEMENT#${year}-${mm}#${cardLast4}`;
}

// ── Plan ──────────────────────────────────────────────────────────────────────

export async function buildMigrationPlan(
  ctx: MigrationContext,
  deps: MigrationDependencies,
): Promise<PlanEntry[]> {
  const objects = await deps.listSourceObjects(ctx.sourcePrefix);
  return objects.map((obj) => ({
    sourceKey: obj.key,
    destKey: deriveDestFromSourceKey(ctx.sub, obj.key),
  }));
}

function deriveDestFromSourceKey(sub: string, key: string): string {
  // Legacy format: statements/{cardLast4}/{year}/{year}-{mm}.json
  const match = key.match(/^statements\/(\d{4})\/(\d{4})\/(\d{4})-(\d{2})\.json$/);
  if (!match) return `users/${sub}/statements/unknown/${key}`;
  const [, cardLast4, , year, month] = match;
  return destKey(sub, cardLast4, Number(year), Number(month));
}

// ── Migration ─────────────────────────────────────────────────────────────────

export async function executeMigration(
  ctx: MigrationContext,
  opts: MigrationOptions,
  deps: MigrationDependencies,
): Promise<MigrationReport> {
  const now = new Date().toISOString();
  const report: MigrationReport = {
    generatedAt: now,
    mode: opts.dryRun ? 'dry-run' : 'apply',
    sub: ctx.sub,
    bucket: ctx.bucket,
    planned: 0,
    copied: 0,
    skipped: 0,
    conflicts: 0,
    entries: [],
    errors: [],
  };

  // Authorization gate — must be active before any write
  if (!opts.dryRun) {
    const authzRaw = await deps.getAuthzRecord(ctx.tableName, ctx.sub);
    const authz = parseAuthorizedUserRecord(authzRaw);
    if (!authz) {
      report.abortReason = `No active authorization record found for sub. Create AUTHZ#${ctx.sub}/PROFILE with active=true in DynamoDB before running with --apply.`;
      return report;
    }
  }

  const objects = await deps.listSourceObjects(ctx.sourcePrefix);
  report.planned = objects.length;

  for (const obj of objects) {
    const entry = await migrateOne(ctx, opts, deps, obj, now);
    report.entries.push(entry);
    if (entry.outcome === 'copied') report.copied++;
    else if (entry.outcome === 'already-migrated') report.skipped++;
    // 'would-copy' counts only toward planned — no writes happened
    else if (entry.outcome === 'conflict') report.conflicts++;
    else if (entry.outcome === 'error') {
      report.errors.push({ key: obj.key, reason: entry.errorDetail ?? 'unknown' });
      report.skipped++;
    }
  }

  return report;
}

async function migrateOne(
  ctx: MigrationContext,
  opts: MigrationOptions,
  deps: MigrationDependencies,
  obj: SourceObjectRef,
  now: string,
): Promise<MigrationEntry> {
  const dest = deriveDestFromSourceKey(ctx.sub, obj.key);
  const entry: MigrationEntry = { sourceKey: obj.key, destKey: dest, outcome: 'error' };

  // Parse the source key to extract coordinates
  const match = obj.key.match(/^statements\/(\d{4})\/(\d{4})\/(\d{4})-(\d{2})\.json$/);
  if (!match) {
    entry.errorDetail = `Invalid legacy key format: ${obj.key}`;
    return entry;
  }
  const [, cardLast4, , yearStr, monthStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);

  // Read and validate source
  let bytes: Buffer;
  try {
    bytes = await deps.getObject(ctx.bucket, obj.key);
  } catch (err) {
    entry.errorDetail = `Failed to read source: ${errorMessage(err)}`;
    return entry;
  }

  let statement: ReturnType<typeof StatementSchema.parse>;
  try {
    statement = StatementSchema.parse(JSON.parse(bytes.toString('utf8')));
  } catch {
    entry.errorDetail = `Invalid statement JSON in ${obj.key}`;
    return entry;
  }

  const checksum = createHash('sha256').update(bytes).digest('hex');
  entry.sha256 = checksum;
  entry.statementId = statementId(cardLast4, year, month);

  // Dry-run: no I/O beyond this point
  if (opts.dryRun) {
    entry.outcome = 'would-copy';
    return entry;
  }

  // Check if destination already exists
  let existingMeta: DestinationMeta | null = null;
  try {
    existingMeta = await deps.headObject(ctx.bucket, dest);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== 'NoSuchKey' && name !== 'NotFound') {
      entry.errorDetail = `Failed to check destination: ${errorMessage(err)}`;
      return entry;
    }
    existingMeta = null;
  }

  if (existingMeta !== null) {
    if (existingMeta.sha256 === checksum) {
      entry.outcome = 'already-migrated';
      return entry;
    }
    entry.outcome = 'conflict';
    entry.errorDetail = `Destination exists with different SHA-256: expected ${checksum}, found ${existingMeta.sha256}`;
    return entry;
  }

  // Copy object
  try {
    await deps.copyObject(ctx.bucket, obj.key, dest);
  } catch (err) {
    entry.errorDetail = `CopyObject failed: ${errorMessage(err)}`;
    return entry;
  }

  // Write DynamoDB metadata
  const metadata = {
    PK: `USER#${ctx.sub}`,
    SK: dynamoSK(cardLast4, year, month),
    statementId: statementId(cardLast4, year, month),
    objectKey: dest,
    cardLast4: statement.cardLast4,
    statementDate: statement.statementDate,
    totalSpend: statement.totals.totalSpend,
    transactionCount: statement.transactions.length,
    sha256: checksum,
    uploadedAt: now,
  };

  try {
    await deps.putStatementMetadata(ctx.tableName, metadata);
  } catch (err) {
    entry.errorDetail = `DynamoDB write failed: ${errorMessage(err)}`;
    entry.outcome = 'error';
    return entry;
  }

  entry.outcome = 'copied';
  return entry;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Production dependency wiring ──────────────────────────────────────────────

function makeProdDeps(s3: S3Client, dynamo: DynamoDBDocumentClient): MigrationDependencies {
  return {
    async listSourceObjects(prefix: string): Promise<SourceObjectRef[]> {
      const results: SourceObjectRef[] = [];
      let token: string | undefined;
      const bucket = process.env.STATEMENTS_BUCKET!;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const obj of page.Contents ?? []) {
          if (obj.Key) results.push({ key: obj.Key, size: obj.Size ?? 0 });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return results;
    },

    async getObject(bucket: string, key: string): Promise<Buffer> {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    },

    async headObject(bucket: string, key: string): Promise<DestinationMeta | null> {
      try {
        const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        const checksum = res.Metadata?.['sha256'] ?? '';
        return { sha256: checksum };
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'NotFound' || name === 'NoSuchKey') return null;
        throw err;
      }
    },

    async copyObject(bucket: string, sourceKey: string, destKey: string): Promise<void> {
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${sourceKey}`,
          Key: destKey,
          MetadataDirective: 'COPY',
        }),
      );
    },

    async getAuthzRecord(tableName: string, sub: string): Promise<unknown> {
      return getAuthorizedUser(dynamo, tableName, sub);
    },

    async putStatementMetadata(tableName: string, record: unknown): Promise<void> {
      await putStatementMetadata(dynamo, tableName, record as Parameters<typeof putStatementMetadata>[2]);
    },
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  sub: string;
  sourcePrefix: string;
  report: string;
  dryRun: boolean;
} {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const sub = get('--user-sub');
  const sourcePrefix = get('--source-prefix') ?? 'statements/';
  const report = get('--report');
  const dryRun = argv.includes('--dry-run');
  const apply = argv.includes('--apply');

  if (!sub) throw new Error('--user-sub <cognito-sub> is required');
  if (!report) throw new Error('--report <path> is required (must be under .migration-private/)');
  if (!dryRun && !apply) throw new Error('One of --dry-run or --apply is required');
  if (dryRun && apply) throw new Error('--dry-run and --apply are mutually exclusive');

  const privateRoot = path.resolve(process.cwd(), '.migration-private');
  const resolvedReport = path.resolve(process.cwd(), report);
  if (!resolvedReport.startsWith(`${privateRoot}${path.sep}`) && resolvedReport !== privateRoot) {
    throw new Error('--report path must be under .migration-private/');
  }

  return { sub, sourcePrefix, report: resolvedReport, dryRun };
}

async function main(): Promise<void> {
  const bucket = process.env.STATEMENTS_BUCKET;
  const tableName = process.env.TABLE_NAME;
  const region = process.env.STORAGE_REGION ?? process.env.AWS_REGION ?? 'ap-southeast-1';
  if (!bucket) throw new Error('STATEMENTS_BUCKET env var is required');
  if (!tableName) throw new Error('TABLE_NAME env var is required');

  const { sub, sourcePrefix, report: reportPath, dryRun } = parseArgs(process.argv.slice(2));

  const s3 = new S3Client({ region });
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const deps = makeProdDeps(s3, dynamo);

  console.log(`Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'APPLY'}`);
  console.log(`Source prefix: ${sourcePrefix}`);
  console.log(`Bucket: ${bucket}`);

  const result = await executeMigration(
    { sub, sourcePrefix, bucket, tableName },
    { dryRun },
    deps,
  );

  if (result.abortReason) {
    console.error(`ABORTED: ${result.abortReason}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(path.dirname(reportPath), { recursive: true, mode: 0o700 });
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  console.log(`Planned:   ${result.planned}`);
  console.log(`Copied:    ${result.copied}`);
  console.log(`Skipped:   ${result.skipped}`);
  console.log(`Conflicts: ${result.conflicts}`);
  console.log(`Errors:    ${result.errors.length}`);
  console.log(`Report:    ${reportPath}`);

  if (result.errors.length > 0 || result.conflicts > 0) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((err: unknown) => {
    console.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
