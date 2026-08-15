import { createHash } from 'node:crypto';

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CostExplorerReportRequestSchema,
  SavedCostReportSchema,
  type CostExplorerReportRequest,
  type SavedCostReport,
} from '@cashight/domain/aws-cost-explorer';
import type { WorkspaceId } from '@cashight/domain/workspace';
import { z } from 'zod';

import { workspacePartition } from '../../shared/storage';

const ReportIdSchema = z.string().uuid();
const PutSavedReportSchema = z
  .object({
    reportId: ReportIdSchema.optional(),
    name: z.string().trim().min(1).max(80),
    request: CostExplorerReportRequestSchema,
  })
  .strict();

const StoredSavedReportSchema = SavedCostReportSchema.extend({
  PK: z.literal('WORKSPACE#primary'),
  SK: z.string().regex(/^AWS_REPORT#[0-9a-f-]{36}$/),
  recordType: z.literal('AWS_SAVED_REPORT'),
}).strict();

interface DocumentSender {
  send(command: never): Promise<unknown>;
}

export interface SavedCostReportStoreDependencies {
  client: DocumentSender;
  tableName: string;
  now?: () => Date;
  randomUUID?: () => string;
}

export type SavedReportErrorCode =
  | 'DUPLICATE_REPORT_NAME'
  | 'INVALID_SAVED_REPORT'
  | 'SAVED_REPORT_WRITE_CONFLICT';

export class SavedReportError extends Error {
  constructor(public readonly code: SavedReportErrorCode) {
    super('Saved report operation failed.');
    this.name = 'SavedReportError';
  }
}

function sendDocument<T>(client: DocumentSender, command: object): Promise<T> {
  return client.send(command as never) as Promise<T>;
}

function normalizedName(name: string): string {
  return name.normalize('NFKC').toLowerCase();
}

function nameDigest(name: string): string {
  return createHash('sha256').update(normalizedName(name), 'utf8').digest('hex');
}

function reportKey(reportId: string): `AWS_REPORT#${string}` {
  return `AWS_REPORT#${reportId}`;
}

function reportNameKey(name: string): `AWS_REPORT_NAME#${string}` {
  return `AWS_REPORT_NAME#${nameDigest(name)}`;
}

function isConditionalFailure(error: unknown): boolean {
  return (
    error instanceof ConditionalCheckFailedException ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error.name === 'ConditionalCheckFailedException' ||
        error.name === 'TransactionCanceledException'))
  );
}

function parseStoredReport(value: unknown): SavedCostReport {
  const parsed = StoredSavedReportSchema.safeParse(value);
  if (!parsed.success) throw new SavedReportError('INVALID_SAVED_REPORT');
  return {
    reportId: parsed.data.reportId,
    name: parsed.data.name,
    request: parsed.data.request,
    createdAt: parsed.data.createdAt,
    updatedAt: parsed.data.updatedAt,
  };
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function createSavedCostReportStore(
  dependencies: SavedCostReportStoreDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());

  async function listSavedReports(
    workspaceId: WorkspaceId,
  ): Promise<SavedCostReport[]> {
    const reports: SavedCostReport[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const response = await sendDocument<{
        Items?: unknown[];
        LastEvaluatedKey?: Record<string, unknown>;
      }>(
        dependencies.client,
        new QueryCommand({
          TableName: dependencies.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': workspacePartition(workspaceId),
            ':prefix': 'AWS_REPORT#',
          },
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: true,
        }),
      );
      reports.push(...(response.Items ?? []).map(parseStoredReport));
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return reports.sort((left, right) => {
      const names = compareStrings(normalizedName(left.name), normalizedName(right.name));
      return names || compareStrings(left.reportId, right.reportId);
    });
  }

  async function getSavedReport(
    workspaceId: WorkspaceId,
    reportId: string,
  ): Promise<SavedCostReport | undefined> {
    const safeId = ReportIdSchema.parse(reportId);
    const response = await sendDocument<{ Item?: unknown }>(
      dependencies.client,
      new GetCommand({
        TableName: dependencies.tableName,
        Key: {
          PK: workspacePartition(workspaceId),
          SK: reportKey(safeId),
        },
        ConsistentRead: true,
      }),
    );
    return response.Item ? parseStoredReport(response.Item) : undefined;
  }

  async function putSavedReport(
    workspaceId: WorkspaceId,
    input: {
      reportId?: string;
      name: string;
      request: CostExplorerReportRequest;
    },
  ): Promise<SavedCostReport> {
    const parsedInput = PutSavedReportSchema.parse(input);
    const reportId = ReportIdSchema.parse(parsedInput.reportId ?? randomUUID());
    const existing = await getSavedReport(workspaceId, reportId);
    const reports = await listSavedReports(workspaceId);
    if (
      reports.some(
        (report) =>
          report.reportId !== reportId &&
          normalizedName(report.name) === normalizedName(parsedInput.name),
      )
    ) {
      throw new SavedReportError('DUPLICATE_REPORT_NAME');
    }

    const timestamp = now().toISOString();
    const report = SavedCostReportSchema.parse({
      reportId,
      name: parsedInput.name,
      request: parsedInput.request,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    const partition = workspacePartition(workspaceId);
    const stored = {
      PK: partition,
      SK: reportKey(reportId),
      recordType: 'AWS_SAVED_REPORT' as const,
      ...report,
    };
    const transaction: Array<Record<string, unknown>> = [];
    if (existing && reportNameKey(existing.name) !== reportNameKey(report.name)) {
      transaction.push({
        Delete: {
          TableName: dependencies.tableName,
          Key: { PK: partition, SK: reportNameKey(existing.name) },
          ConditionExpression: 'reportId = :reportId',
          ExpressionAttributeValues: { ':reportId': reportId },
        },
      });
    }
    transaction.push({
      Put: {
        TableName: dependencies.tableName,
        Item: {
          PK: partition,
          SK: reportNameKey(report.name),
          recordType: 'AWS_SAVED_REPORT_NAME',
          reportId,
        },
        ConditionExpression: 'attribute_not_exists(PK) OR reportId = :reportId',
        ExpressionAttributeValues: { ':reportId': reportId },
      },
    });
    transaction.push({
      Put: {
        TableName: dependencies.tableName,
        Item: stored,
        ConditionExpression: existing
          ? 'attribute_exists(PK)'
          : 'attribute_not_exists(PK)',
      },
    });

    try {
      await sendDocument(
        dependencies.client,
        new TransactWriteCommand({ TransactItems: transaction }),
      );
      return report;
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new SavedReportError('SAVED_REPORT_WRITE_CONFLICT');
      }
      throw error;
    }
  }

  async function deleteSavedReport(
    workspaceId: WorkspaceId,
    reportId: string,
  ): Promise<boolean> {
    const safeId = ReportIdSchema.parse(reportId);
    const existing = await getSavedReport(workspaceId, safeId);
    if (!existing) return false;
    const partition = workspacePartition(workspaceId);
    try {
      await sendDocument(
        dependencies.client,
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: dependencies.tableName,
                Key: { PK: partition, SK: reportNameKey(existing.name) },
                ConditionExpression: 'reportId = :reportId',
                ExpressionAttributeValues: { ':reportId': safeId },
              },
            },
            {
              Delete: {
                TableName: dependencies.tableName,
                Key: { PK: partition, SK: reportKey(safeId) },
                ConditionExpression: 'reportId = :reportId',
                ExpressionAttributeValues: { ':reportId': safeId },
              },
            },
          ],
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  }

  return {
    listSavedReports,
    getSavedReport,
    putSavedReport,
    deleteSavedReport,
  };
}
