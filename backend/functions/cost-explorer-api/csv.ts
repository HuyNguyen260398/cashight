import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  CostExplorerReportRequestSchema,
  type CostExplorerReportRequest,
} from '@cashight/domain/aws-cost-explorer';
import { WorkspaceIdSchema, type WorkspaceId } from '@cashight/domain/workspace';
import { z } from 'zod';

import type { CompleteCostExplorerResult } from './aws-adapter';

const EXPORT_EXPIRY_SECONDS = 5 * 60;
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const UuidSchema = z.string().uuid();
const DecimalSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface S3Sender {
  send(command: never): Promise<unknown>;
}

export interface CostCsvExporterDependencies {
  s3: S3Sender;
  bucket: string;
  now?: () => Date;
  randomUUID?: () => string;
  presignGet?: (input: {
    bucket: string;
    key: string;
    expiresIn: number;
  }) => Promise<string>;
}

export interface CostCsvExportResponse {
  downloadUrl: string;
  expiresAt: string;
  fileName: string;
}

function csvCell(value: string): string {
  const formulaSafe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(formulaSafe)
    ? `"${formulaSafe.replace(/"/g, '""')}"`
    : formulaSafe;
}

function validateCsvResult(
  result: CompleteCostExplorerResult,
  request: CostExplorerReportRequest,
): void {
  if (!result.currencyOrUnit || result.periods.length === 0) {
    throw new Error('Cost CSV result is incomplete.');
  }
  for (const period of result.periods) {
    IsoDateSchema.parse(period.start);
    IsoDateSchema.parse(period.end);
  }
  for (const row of result.breakdown) {
    if (
      row.groupValues.length > request.groupBy.length ||
      row.values.length !== result.periods.length
    ) {
      throw new Error('Cost CSV row does not match the active report.');
    }
    DecimalSchema.parse(row.total);
    for (const value of row.values) DecimalSchema.parse(value);
  }
}

export function createCostCsv(
  result: CompleteCostExplorerResult,
  rawRequest: CostExplorerReportRequest,
): Uint8Array {
  const request = CostExplorerReportRequestSchema.parse(rawRequest);
  validateCsvResult(result, request);
  const groupCount = request.groupBy.length;
  const header = [
    ...Array.from({ length: groupCount }, (_, index) => `Group ${index + 1}`),
    'Currency/Unit',
    'Total',
    ...result.periods.map((period) => period.start),
  ];
  const rows = result.breakdown.map((row) => [
    ...Array.from({ length: groupCount }, (_, index) => row.groupValues[index] ?? ''),
    result.currencyOrUnit,
    row.total,
    ...row.values,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(','))
    .join('\r\n');
  return new TextEncoder().encode(`\uFEFF${csv}\r\n`);
}

function sendS3<T>(client: S3Sender, command: object): Promise<T> {
  return client.send(command as never) as Promise<T>;
}

export function createCostCsvExporter(
  dependencies: CostCsvExporterDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const presignGet =
    dependencies.presignGet ??
    (async ({ bucket, key, expiresIn }) =>
      getSignedUrl(
        dependencies.s3 as unknown as S3Client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn },
      ));

  async function exportCsv(
    workspaceId: WorkspaceId,
    digest: string,
    result: CompleteCostExplorerResult,
    request: CostExplorerReportRequest,
  ): Promise<CostCsvExportResponse> {
    const safeWorkspace = WorkspaceIdSchema.parse(workspaceId);
    const safeDigest = DigestSchema.parse(digest);
    const exportId = UuidSchema.parse(randomUUID());
    const createdAt = now();
    const expiresAt = new Date(
      createdAt.getTime() + EXPORT_EXPIRY_SECONDS * 1_000,
    );
    const fileName = `cashight-cost-explorer-${createdAt.toISOString().slice(0, 10)}.csv`;
    const key = `exports/${safeWorkspace}/${safeDigest}/${exportId}.csv`;
    const body = createCostCsv(result, request);

    await sendS3(
      dependencies.s3,
      new PutObjectCommand({
        Bucket: dependencies.bucket,
        Key: key,
        Body: body,
        ContentType: 'text/csv; charset=utf-8',
        ContentDisposition: `attachment; filename="${fileName}"`,
        ServerSideEncryption: 'AES256',
        Metadata: {
          schemaVersion: '1',
          expiresAtEpoch: String(Math.floor(expiresAt.getTime() / 1_000)),
        },
      }),
    );
    const downloadUrl = await presignGet({
      bucket: dependencies.bucket,
      key,
      expiresIn: EXPORT_EXPIRY_SECONDS,
    });
    return {
      downloadUrl,
      expiresAt: expiresAt.toISOString(),
      fileName,
    };
  }

  return { exportCsv };
}
