/**
 * Copy the Cognito authorization records (AUTHZ#<sub> / PROFILE) from the v1
 * table into the v2 table.
 *
 * auth-guard writes these records only to the v1 table at sign-in, and every
 * v2 API checks them in the v2 table (getAuthorizedUser), so without a copy v2
 * denies every request. Reads the source only; overwrites the target copies,
 * so re-running refreshes v2 from v1. Prints counts, never record contents.
 *
 * Usage: pnpm tsx scripts/v2/seed-authz.ts --source cashight --target cashight-v2 [--dry-run]
 * See docs/v2-resources.md.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

/** The v1 table. The seed never writes into it. */
const V1_TABLE = 'cashight';

/** Same pattern as backend/shared/metadata.ts. */
const AUTHZ_PK = /^AUTHZ#[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface SeedDeps {
  /** Every item whose PK begins with AUTHZ# and whose SK is PROFILE. */
  scan(table: string): Promise<Record<string, unknown>[]>;
  /** Unconditional overwrite. */
  put(table: string, item: Record<string, unknown>): Promise<void>;
}

export interface SeedOptions {
  sourceTable: string;
  targetTable: string;
  dryRun: boolean;
}

export interface SeedReport {
  copied: number;
  skipped: number;
}

function isAuthorizationProfile(item: Record<string, unknown>): boolean {
  return typeof item.PK === 'string' && AUTHZ_PK.test(item.PK) && item.SK === 'PROFILE';
}

export async function seedAuthorizations(
  deps: SeedDeps,
  options: SeedOptions,
): Promise<SeedReport> {
  if (options.targetTable === V1_TABLE) {
    throw new Error(`Refusing: target table ${V1_TABLE} is the v1 table`);
  }
  if (options.sourceTable === options.targetTable) {
    throw new Error('Refusing: source and target are the same table');
  }

  const items = await deps.scan(options.sourceTable);
  const report: SeedReport = { copied: 0, skipped: 0 };
  for (const item of items) {
    if (!isAuthorizationProfile(item)) {
      report.skipped += 1;
      continue;
    }
    if (!options.dryRun) await deps.put(options.targetTable, item);
    report.copied += 1;
  }
  return report;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function dynamoDeps(client: DynamoDBDocumentClient): SeedDeps {
  return {
    async scan(table) {
      const items: Record<string, unknown>[] = [];
      let startKey: Record<string, unknown> | undefined;
      do {
        const page = await client.send(
          new ScanCommand({
            TableName: table,
            FilterExpression: 'begins_with(PK, :p) AND SK = :sk',
            ExpressionAttributeValues: { ':p': 'AUTHZ#', ':sk': 'PROFILE' },
            ExclusiveStartKey: startKey,
          }),
        );
        items.push(...(page.Items ?? []));
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return items;
    },
    async put(table, item) {
      await client.send(new PutCommand({ TableName: table, Item: item }));
    },
  };
}

async function main(): Promise<void> {
  const sourceTable = readOption('--source');
  const targetTable = readOption('--target');
  if (!sourceTable || !targetTable) {
    throw new Error(
      'Usage: pnpm tsx scripts/v2/seed-authz.ts --source <v1 table> --target <v2 table> [--dry-run]',
    );
  }
  const dryRun = process.argv.includes('--dry-run');
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-southeast-1' }),
  );

  const report = await seedAuthorizations(dynamoDeps(client), { sourceTable, targetTable, dryRun });
  console.log(`${dryRun ? 'dry-run ' : ''}copied=${report.copied} skipped=${report.skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
