import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { StatementSchema } from '@cashight/domain/schemas';
import { z } from 'zod';

import {
  parseStatementMetadataRecord,
  type StatementMetadataRecord,
} from '../backend/shared/metadata';
import {
  legacyStatementObjectKey,
  statementId,
  statementObjectKey,
  workspacePartition,
} from '../backend/shared/storage';

const sourceSubjectSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export interface WorkspaceMigrationOptions {
  mode: 'dry-run' | 'apply';
  sourceSub: string;
}

export interface WorkspaceMigrationDependencies {
  listObjects(prefix: string): Promise<string[]>;
  readObject(key: string): Promise<Uint8Array | undefined>;
  readMetadata(pk: string, sk: string): Promise<unknown>;
  copyObject(
    sourceKey: string,
    destinationKey: string,
    sha256: string,
  ): Promise<void>;
  putMetadata(record: StatementMetadataRecord): Promise<void>;
}

export interface WorkspaceMigrationOperation {
  sourceKey: string;
  destinationKey: string;
  sha256?: string;
  sourceMetadataKey: { PK: string; SK: string };
  destinationMetadataKey: { PK: string; SK: string };
  validationStatus: 'VALID' | 'INVALID';
  errorCode?: string;
  destinationMetadata?: StatementMetadataRecord;
}

export interface WorkspaceMigrationReport {
  mode: WorkspaceMigrationOptions['mode'];
  planned: number;
  copied: number;
  alreadyPresent: number;
  conflicts: number;
  invalid: number;
  validated: number;
  operations: Array<
    WorkspaceMigrationOperation & {
      outcome:
        | 'WOULD_COPY'
        | 'COPIED'
        | 'ALREADY_PRESENT'
        | 'CONFLICT'
        | 'INVALID';
    }
  >;
}

export function parseWorkspaceMigrationArgs(
  args: string[],
): WorkspaceMigrationOptions {
  const knownFlags = new Set([
    '--dry-run',
    '--apply',
    '--source-sub',
    '--confirm-copy-to-primary',
  ]);
  for (const arg of args) {
    if (arg.startsWith('--') && !knownFlags.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  if (dryRun === apply) {
    throw new Error('Choose exactly one mode: --dry-run or --apply.');
  }

  const sourceIndex = args.indexOf('--source-sub');
  const sourceSub = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
  if (!sourceSubjectSchema.safeParse(sourceSub).success) {
    throw new Error('A valid --source-sub value is required.');
  }
  if (args.indexOf('--source-sub', sourceIndex + 1) >= 0) {
    throw new Error('--source-sub may be provided only once.');
  }

  const confirmation = args.includes('--confirm-copy-to-primary');
  if (apply && !confirmation) {
    throw new Error('Apply requires --confirm-copy-to-primary.');
  }
  if (dryRun && confirmation) {
    throw new Error('The apply confirmation is not valid with --dry-run.');
  }

  const expectedLength = apply ? 4 : 3;
  if (args.length !== expectedLength) {
    throw new Error('Unexpected positional or duplicate arguments.');
  }

  return {
    mode: dryRun ? 'dry-run' : 'apply',
    sourceSub: sourceSub as string,
  };
}

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

function statementCoordinates(statementDate: string): {
  year: number;
  month: number;
} {
  const match = statementDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) throw new Error('INVALID_STATEMENT_DATE');
  return { year: Number(match[1]), month: Number(match[2]) };
}

function invalidOperation(
  sourceSub: string,
  sourceKey: string,
  errorCode: string,
): WorkspaceMigrationOperation {
  return {
    sourceKey,
    destinationKey: sourceKey.replace(
      `users/${sourceSub}/statements/`,
      'users/primary/statements/',
    ),
    sourceMetadataKey: { PK: `USER#${sourceSub}`, SK: 'INVALID' },
    destinationMetadataKey: { PK: 'WORKSPACE#primary', SK: 'INVALID' },
    validationStatus: 'INVALID',
    errorCode,
  };
}

async function planOperation(
  sourceSub: string,
  sourceKey: string,
  deps: WorkspaceMigrationDependencies,
): Promise<WorkspaceMigrationOperation> {
  try {
    const body = await deps.readObject(sourceKey);
    if (!body) return invalidOperation(sourceSub, sourceKey, 'SOURCE_NOT_FOUND');

    let statement;
    try {
      statement = StatementSchema.parse(
        JSON.parse(Buffer.from(body).toString('utf8')),
      );
    } catch {
      return invalidOperation(sourceSub, sourceKey, 'INVALID_STATEMENT');
    }

    const { year, month } = statementCoordinates(statement.statementDate);
    const expectedSourceKey = legacyStatementObjectKey(
      sourceSub,
      statement.cardLast4,
      year,
      month,
    );
    if (sourceKey !== expectedSourceKey) {
      return invalidOperation(sourceSub, sourceKey, 'SOURCE_KEY_MISMATCH');
    }

    const id = statementId(statement.cardLast4, year, month);
    const sk = `STATEMENT#${id.slice(0, 7)}#${statement.cardLast4}`;
    const sourceMetadataKey = { PK: `USER#${sourceSub}`, SK: sk };
    let sourceMetadata: StatementMetadataRecord;
    try {
      sourceMetadata = parseStatementMetadataRecord(
        await deps.readMetadata(sourceMetadataKey.PK, sourceMetadataKey.SK),
      );
    } catch {
      return invalidOperation(sourceSub, sourceKey, 'INVALID_SOURCE_METADATA');
    }
    if (
      sourceMetadata.objectKey !== sourceKey ||
      sourceMetadata.statementId !== id ||
      sourceMetadata.cardLast4 !== statement.cardLast4
    ) {
      return invalidOperation(sourceSub, sourceKey, 'SOURCE_METADATA_MISMATCH');
    }

    const destinationKey = statementObjectKey(
      'primary',
      statement.cardLast4,
      year,
      month,
    );
    const digest = sha256(body);
    const destinationMetadata: StatementMetadataRecord = {
      ...sourceMetadata,
      PK: workspacePartition('primary'),
      objectKey: destinationKey,
      sha256: digest,
    };

    return {
      sourceKey,
      destinationKey,
      sha256: digest,
      sourceMetadataKey,
      destinationMetadataKey: {
        PK: destinationMetadata.PK,
        SK: destinationMetadata.SK,
      },
      destinationMetadata,
      validationStatus: 'VALID',
    };
  } catch {
    return invalidOperation(sourceSub, sourceKey, 'VALIDATION_FAILED');
  }
}

export async function buildWorkspaceMigrationPlan(
  sourceSub: string,
  deps: WorkspaceMigrationDependencies,
): Promise<WorkspaceMigrationOperation[]> {
  const parsedSub = sourceSubjectSchema.parse(sourceSub);
  const prefix = `users/${parsedSub}/statements/`;
  const keys = (await deps.listObjects(prefix))
    .filter((key) => key.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b));
  const operations: WorkspaceMigrationOperation[] = [];
  for (const key of keys) {
    operations.push(await planOperation(parsedSub, key, deps));
  }
  return operations;
}

function metadataMatches(
  actual: StatementMetadataRecord,
  expected: StatementMetadataRecord,
): boolean {
  return (
    actual.PK === expected.PK &&
    actual.SK === expected.SK &&
    actual.statementId === expected.statementId &&
    actual.objectKey === expected.objectKey &&
    actual.sha256 === expected.sha256
  );
}

async function validateDestination(
  operation: WorkspaceMigrationOperation,
  deps: WorkspaceMigrationDependencies,
): Promise<boolean> {
  if (!operation.sha256 || !operation.destinationMetadata) return false;
  const destinationBody = await deps.readObject(operation.destinationKey);
  if (!destinationBody || sha256(destinationBody) !== operation.sha256) {
    return false;
  }
  try {
    const metadata = parseStatementMetadataRecord(
      await deps.readMetadata(
        operation.destinationMetadataKey.PK,
        operation.destinationMetadataKey.SK,
      ),
    );
    return metadataMatches(metadata, operation.destinationMetadata);
  } catch {
    return false;
  }
}

export async function executeWorkspaceMigration(
  options: WorkspaceMigrationOptions,
  deps: WorkspaceMigrationDependencies,
): Promise<WorkspaceMigrationReport> {
  const plan = await buildWorkspaceMigrationPlan(options.sourceSub, deps);
  const report: WorkspaceMigrationReport = {
    mode: options.mode,
    planned: plan.length,
    copied: 0,
    alreadyPresent: 0,
    conflicts: 0,
    invalid: 0,
    validated: 0,
    operations: [],
  };

  for (const operation of plan) {
    if (
      operation.validationStatus === 'INVALID' ||
      !operation.sha256 ||
      !operation.destinationMetadata
    ) {
      report.invalid += 1;
      report.operations.push({ ...operation, outcome: 'INVALID' });
      continue;
    }

    if (options.mode === 'dry-run') {
      report.validated += 1;
      report.operations.push({ ...operation, outcome: 'WOULD_COPY' });
      continue;
    }

    const existingBody = await deps.readObject(operation.destinationKey);
    let existingMetadata: StatementMetadataRecord | undefined;
    const rawMetadata = await deps.readMetadata(
      operation.destinationMetadataKey.PK,
      operation.destinationMetadataKey.SK,
    );
    if (rawMetadata !== undefined) {
      try {
        existingMetadata = parseStatementMetadataRecord(rawMetadata);
      } catch {
        report.conflicts += 1;
        report.operations.push({ ...operation, outcome: 'CONFLICT' });
        continue;
      }
    }

    if (existingBody && sha256(existingBody) !== operation.sha256) {
      report.conflicts += 1;
      report.operations.push({ ...operation, outcome: 'CONFLICT' });
      continue;
    }
    if (
      existingMetadata &&
      !metadataMatches(existingMetadata, operation.destinationMetadata)
    ) {
      report.conflicts += 1;
      report.operations.push({ ...operation, outcome: 'CONFLICT' });
      continue;
    }

    const alreadyPresent = existingBody !== undefined && existingMetadata !== undefined;
    if (!existingBody) {
      await deps.copyObject(
        operation.sourceKey,
        operation.destinationKey,
        operation.sha256,
      );
    }
    if (!existingMetadata) {
      await deps.putMetadata(operation.destinationMetadata);
    }

    if (!(await validateDestination(operation, deps))) {
      report.invalid += 1;
      report.operations.push({
        ...operation,
        validationStatus: 'INVALID',
        errorCode: 'DESTINATION_VALIDATION_FAILED',
        outcome: 'INVALID',
      });
      continue;
    }

    report.validated += 1;
    if (alreadyPresent) {
      report.alreadyPresent += 1;
      report.operations.push({ ...operation, outcome: 'ALREADY_PRESENT' });
    } else {
      report.copied += 1;
      report.operations.push({ ...operation, outcome: 'COPIED' });
    }
  }

  return report;
}

export function formatWorkspaceMigrationReport(
  report: WorkspaceMigrationReport,
  sourceSub: string,
): string {
  const redact = (value: string) => value.split(sourceSub).join('[source-sub]');
  return JSON.stringify(
    {
      mode: report.mode,
      planned: report.planned,
      copied: report.copied,
      alreadyPresent: report.alreadyPresent,
      conflicts: report.conflicts,
      invalid: report.invalid,
      validated: report.validated,
      operations: report.operations.map((operation) => ({
        sourceKey: redact(operation.sourceKey),
        destinationKey: operation.destinationKey,
        sha256: operation.sha256,
        metadataKey: operation.destinationMetadataKey,
        validationStatus: operation.validationStatus,
        outcome: operation.outcome,
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
      })),
    },
    null,
    2,
  );
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function createAwsDependencies(
  bucket: string,
  tableName: string,
  region: string,
): WorkspaceMigrationDependencies {
  const s3 = new S3Client({ region });
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  return {
    listObjects: async (prefix) => {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        keys.push(
          ...(result.Contents ?? []).flatMap((item) =>
            item.Key ? [item.Key] : [],
          ),
        );
        continuationToken = result.NextContinuationToken;
      } while (continuationToken);
      return keys;
    },
    readObject: async (key) => {
      try {
        const result = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        return result.Body?.transformToByteArray();
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        const name = (error as { name?: string }).name;
        if (status === 404 || name === 'NoSuchKey' || name === 'NotFound') {
          return undefined;
        }
        throw error;
      }
    },
    readMetadata: async (pk, sk) => {
      const result = await dynamo.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: pk, SK: sk },
          ConsistentRead: true,
        }),
      );
      return result.Item;
    },
    copyObject: async (sourceKey, destinationKey, digest) => {
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${sourceKey}`,
          Key: destinationKey,
          MetadataDirective: 'REPLACE',
          Metadata: { sha256: digest },
          ContentType: 'application/json',
        }),
      );
    },
    putMetadata: async (record) => {
      await dynamo.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    },
  };
}

async function main(): Promise<void> {
  const options = parseWorkspaceMigrationArgs(process.argv.slice(2));
  const bucket = requiredEnvironmentValue('STATEMENTS_BUCKET');
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const region =
    process.env.STORAGE_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    'ap-southeast-1';
  const report = await executeWorkspaceMigration(
    options,
    createAwsDependencies(bucket, tableName, region),
  );
  console.log(formatWorkspaceMigrationReport(report, options.sourceSub));
  if (report.conflicts > 0 || report.invalid > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.name : 'MigrationError',
      }),
    );
    process.exitCode = 1;
  });
}
