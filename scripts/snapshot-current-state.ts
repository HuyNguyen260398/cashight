import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

import { StatementSchema } from '@/lib/schemas';

export interface StateSnapshot {
  generatedAt: string;
  bucket: string;
  objectCount: number;
  versioningStatus: string;
  statements: Array<{
    key: string;
    cardLast4: string;
    statementDate: string;
    totalSpend: number;
    transactionCount: number;
    sha256: string;
  }>;
}

interface BuildStateSnapshotOptions {
  bucket: string;
  s3: S3Client;
  now?: () => Date;
}

const PRIVATE_SNAPSHOT_DIRECTORY = '.migration-private';
const DEFAULT_REGION = 'ap-southeast-1';

export function resolveSnapshotOutputPath(
  output: string,
  cwd = process.cwd(),
): string {
  const privateRoot = path.resolve(cwd, PRIVATE_SNAPSHOT_DIRECTORY);
  const resolvedOutput = path.resolve(cwd, output);
  if (
    resolvedOutput === privateRoot ||
    !resolvedOutput.startsWith(`${privateRoot}${path.sep}`)
  ) {
    throw new Error(
      'Snapshot output must be a file under .migration-private/',
    );
  }
  return resolvedOutput;
}

export async function buildStateSnapshot({
  bucket,
  s3,
  now = () => new Date(),
}: BuildStateSnapshotOptions): Promise<StateSnapshot> {
  const versioning = await s3.send(
    new GetBucketVersioningCommand({ Bucket: bucket }),
  );
  const statements: StateSnapshot['statements'] = [];
  let continuationToken: string | undefined;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'statements/',
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of page.Contents ?? []) {
      if (!object.Key) {
        throw new Error('S3 returned a statement object without a key');
      }
      const response = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: object.Key }),
      );
      if (!response.Body) {
        throw new Error(`Statement object body is empty: ${object.Key}`);
      }
      const bytes = await response.Body.transformToByteArray();
      const statement = StatementSchema.parse(
        JSON.parse(Buffer.from(bytes).toString('utf8')),
      );
      statements.push({
        key: object.Key,
        cardLast4: statement.cardLast4,
        statementDate: statement.statementDate,
        totalSpend: statement.totals.totalSpend,
        transactionCount: statement.transactions.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }

    continuationToken = page.NextContinuationToken;
    if (page.IsTruncated && !continuationToken) {
      throw new Error('S3 pagination ended without a continuation token');
    }
  } while (continuationToken);

  return {
    generatedAt: now().toISOString(),
    bucket,
    objectCount: statements.length,
    versioningStatus: versioning.Status ?? 'NotEnabled',
    statements,
  };
}

function outputArgument(argv: string[]): string {
  const outputIndex = argv.indexOf('--output');
  const output = outputIndex === -1 ? undefined : argv[outputIndex + 1];
  if (!output) {
    throw new Error(
      'Usage: pnpm tsx scripts/snapshot-current-state.ts --output .migration-private/current-state.json',
    );
  }
  return output;
}

async function main(): Promise<void> {
  const bucket = process.env.STATEMENTS_BUCKET;
  if (!bucket) {
    throw new Error('STATEMENTS_BUCKET is required');
  }
  const outputPath = resolveSnapshotOutputPath(outputArgument(process.argv.slice(2)));
  const region = process.env.STORAGE_REGION ?? process.env.AWS_REGION ?? DEFAULT_REGION;
  const snapshot = await buildStateSnapshot({
    bucket,
    s3: new S3Client({ region }),
  });

  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  console.log(`Wrote ${snapshot.objectCount} statement records to ${outputPath}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Snapshot failed: ${message}`);
    process.exitCode = 1;
  });
}
