import { createHash } from 'node:crypto';

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { CostExplorerResultSchema } from '@cashight/domain/aws-cost-explorer';
import type { WorkspaceId } from '@cashight/domain/workspace';
import { z } from 'zod';

import {
  costQueryCacheChunkKey,
  costQueryCacheManifestKey,
  costQueryCachePrefix,
  type CostQueryCacheChunkRecord,
  type CostQueryCacheManifestRecord,
} from '../../shared/metadata';
import { workspacePartition } from '../../shared/storage';
import type { CompleteCostExplorerResult } from './aws-adapter';

export const COST_CACHE_CHUNK_BYTES = 300 * 1_024;
const CURRENT_RESULT_TTL_SECONDS = 60 * 60;
const HISTORICAL_RESULT_TTL_SECONDS = 24 * 60 * 60;
const REFRESH_COOLDOWN_SECONDS = 5 * 60;
const QUERY_LOCK_SECONDS = 35;
const QUERY_WAIT_MILLISECONDS = 20_000;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CompleteCostExplorerResultSchema = CostExplorerResultSchema.extend({
  breakdown: z.array(CostExplorerResultSchema.shape.breakdown.element),
  pageCount: z.number().int().positive(),
}).strict();

const ManifestSchema = z
  .object({
    PK: z.string(),
    SK: z.string(),
    recordType: z.literal('AWS_QUERY_CACHE_MANIFEST'),
    schemaVersion: z.literal(1),
    chunkCount: z.number().int().positive(),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
    asOf: z.string().datetime(),
    publishedAtEpoch: z.number().int().nonnegative(),
    expiresAtEpoch: z.number().int().positive(),
  })
  .passthrough();

const ChunkSchema = z
  .object({
    PK: z.string(),
    SK: z.string(),
    recordType: z.literal('AWS_QUERY_CACHE_CHUNK'),
    schemaVersion: z.literal(1),
    chunkIndex: z.number().int().positive(),
    payload: z.string(),
    expiresAtEpoch: z.number().int().positive(),
  })
  .passthrough();

export type CostCacheMissReason =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'MANIFEST_INVALID'
  | 'CHUNK_COUNT'
  | 'CHUNK_INVALID'
  | 'HASH_MISMATCH'
  | 'PAYLOAD_INVALID';

interface DocumentSender {
  send(command: never): Promise<unknown>;
}

export interface CostExplorerCacheDependencies {
  client: DocumentSender;
  tableName: string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  onCacheMiss?: (reason: CostCacheMissReason) => void;
}

function sendDocument<T>(client: DocumentSender, command: object): Promise<T> {
  return client.send(command as never) as Promise<T>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateDigest(digest: string): string {
  return DigestSchema.parse(digest);
}

export function serializeCostResultChunks(
  result: CompleteCostExplorerResult,
): string[] {
  const validated = CompleteCostExplorerResultSchema.parse(result);
  const bytes = new TextEncoder().encode(JSON.stringify(validated));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks: string[] = [];
  let offset = 0;

  while (offset < bytes.byteLength) {
    let end = Math.min(offset + COST_CACHE_CHUNK_BYTES, bytes.byteLength);
    while (end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end -= 1;
    if (end === offset) throw new Error('Unable to split UTF-8 cache payload.');
    chunks.push(decoder.decode(bytes.subarray(offset, end)));
    offset = end;
  }

  return chunks;
}

function nextUtcMonthStart(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 10);
}

export function selectCostResultExpiry(
  request: CostExplorerReportRequest,
  now: Date,
): number {
  const currentDate = now.toISOString().slice(0, 10);
  const currentMonthStart = `${currentDate.slice(0, 7)}-01`;
  const includesCurrentMonth =
    request.timePeriod.start < nextUtcMonthStart(now) &&
    request.timePeriod.end > currentMonthStart;
  const isCurrent = request.timePeriod.end > currentDate || includesCurrentMonth;
  return (
    Math.floor(now.getTime() / 1_000) +
    (isCurrent ? CURRENT_RESULT_TTL_SECONDS : HISTORICAL_RESULT_TTL_SECONDS)
  );
}

function isConditionalFailure(error: unknown): boolean {
  return (
    error instanceof ConditionalCheckFailedException ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'ConditionalCheckFailedException')
  );
}

export function createCostExplorerCache(dependencies: CostExplorerCacheDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = dependencies.random ?? Math.random;

  function miss(reason: CostCacheMissReason): undefined {
    dependencies.onCacheMiss?.(reason);
    return undefined;
  }

  async function queryCacheRecords(
    workspaceId: WorkspaceId,
    digest: string,
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const response = await sendDocument<{
        Items?: Record<string, unknown>[];
        LastEvaluatedKey?: Record<string, unknown>;
      }>(
        dependencies.client,
        new QueryCommand({
          TableName: dependencies.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': workspacePartition(workspaceId),
            ':prefix': costQueryCachePrefix(validateDigest(digest)),
          },
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: true,
        }),
      );
      items.push(...(response.Items ?? []));
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  async function getCachedCostResult(
    workspaceId: WorkspaceId,
    digest: string,
    readAt: Date,
  ): Promise<CompleteCostExplorerResult | undefined> {
    const records = await queryCacheRecords(workspaceId, digest);
    if (records.length === 0) return miss('NOT_FOUND');

    const manifestRecords = records.filter(
      (record) => record.SK === costQueryCacheManifestKey(digest),
    );
    if (manifestRecords.length !== 1) return miss('MANIFEST_INVALID');
    const parsedManifest = ManifestSchema.safeParse(manifestRecords[0]);
    if (!parsedManifest.success) return miss('MANIFEST_INVALID');
    const manifest = parsedManifest.data;
    if (manifest.expiresAtEpoch <= Math.floor(readAt.getTime() / 1_000)) {
      return miss('EXPIRED');
    }

    const rawChunks = records.filter((record) =>
      String(record.SK).includes('#CHUNK#'),
    );
    if (rawChunks.length !== manifest.chunkCount) return miss('CHUNK_COUNT');
    const chunks: CostQueryCacheChunkRecord[] = [];
    for (let index = 1; index <= manifest.chunkCount; index += 1) {
      const expectedKey = costQueryCacheChunkKey(digest, index);
      const matches = rawChunks.filter((record) => record.SK === expectedKey);
      if (matches.length !== 1) return miss('CHUNK_COUNT');
      const parsed = ChunkSchema.safeParse(matches[0]);
      if (
        !parsed.success ||
        parsed.data.chunkIndex !== index ||
        parsed.data.expiresAtEpoch !== manifest.expiresAtEpoch
      ) {
        return miss('CHUNK_INVALID');
      }
      chunks.push(parsed.data as CostQueryCacheChunkRecord);
    }

    const payload = chunks.map((chunk) => chunk.payload).join('');
    if (sha256(payload) !== manifest.payloadSha256) return miss('HASH_MISMATCH');
    try {
      const parsed = CompleteCostExplorerResultSchema.parse(JSON.parse(payload));
      return { ...parsed, source: 'CACHE' } as CompleteCostExplorerResult;
    } catch {
      return miss('PAYLOAD_INVALID');
    }
  }

  async function putCachedCostResult(
    workspaceId: WorkspaceId,
    digest: string,
    result: CompleteCostExplorerResult,
    expiresAtEpoch: number,
  ): Promise<void> {
    const safeDigest = validateDigest(digest);
    const chunks = serializeCostResultChunks(result);
    const payloadSha256 = sha256(chunks.join(''));
    const partition = workspacePartition(workspaceId);
    const publishedAtEpoch = Math.floor(now().getTime() / 1_000);

    for (let index = 0; index < chunks.length; index += 1) {
      const record: CostQueryCacheChunkRecord = {
        PK: partition,
        SK: costQueryCacheChunkKey(safeDigest, index + 1),
        recordType: 'AWS_QUERY_CACHE_CHUNK',
        schemaVersion: 1,
        chunkIndex: index + 1,
        payload: chunks[index],
        expiresAtEpoch,
      };
      await sendDocument(
        dependencies.client,
        new PutCommand({ TableName: dependencies.tableName, Item: record }),
      );
    }

    const existing = await queryCacheRecords(workspaceId, safeDigest);
    for (const record of existing) {
      const match = /#CHUNK#(\d{6})$/.exec(String(record.SK));
      if (match && Number(match[1]) > chunks.length) {
        await sendDocument(
          dependencies.client,
          new DeleteCommand({
            TableName: dependencies.tableName,
            Key: { PK: partition, SK: record.SK },
          }),
        );
      }
    }

    const manifest: CostQueryCacheManifestRecord = {
      PK: partition,
      SK: costQueryCacheManifestKey(safeDigest),
      recordType: 'AWS_QUERY_CACHE_MANIFEST',
      schemaVersion: 1,
      chunkCount: chunks.length,
      payloadSha256,
      asOf: result.asOf,
      publishedAtEpoch,
      expiresAtEpoch,
    };
    await sendDocument(
      dependencies.client,
      new PutCommand({
        TableName: dependencies.tableName,
        Item: manifest,
        ConditionExpression:
          'attribute_not_exists(PK) OR publishedAtEpoch <= :publishedAt',
        ExpressionAttributeValues: { ':publishedAt': publishedAtEpoch },
      }),
    );
  }

  async function claimManualRefresh(
    workspaceId: WorkspaceId,
    digest: string,
    claimAt: Date,
  ): Promise<boolean> {
    const nowEpoch = Math.floor(claimAt.getTime() / 1_000);
    try {
      await sendDocument(
        dependencies.client,
        new PutCommand({
          TableName: dependencies.tableName,
          Item: {
            PK: workspacePartition(workspaceId),
            SK: `AWS_REFRESH#${validateDigest(digest)}`,
            expiresAtEpoch: nowEpoch + REFRESH_COOLDOWN_SECONDS,
          },
          ConditionExpression:
            'attribute_not_exists(PK) OR expiresAtEpoch <= :now',
          ExpressionAttributeValues: { ':now': nowEpoch },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  }

  async function getManualRefreshCooldown(
    workspaceId: WorkspaceId,
    digest: string,
  ): Promise<number | undefined> {
    const response = await sendDocument<{ Item?: Record<string, unknown> }>(
      dependencies.client,
      new GetCommand({
        TableName: dependencies.tableName,
        Key: {
          PK: workspacePartition(workspaceId),
          SK: `AWS_REFRESH#${validateDigest(digest)}`,
        },
        ConsistentRead: true,
      }),
    );
    return typeof response.Item?.expiresAtEpoch === 'number'
      ? response.Item.expiresAtEpoch
      : undefined;
  }

  async function claimQueryExecution(
    workspaceId: WorkspaceId,
    digest: string,
    requestId: string,
    claimAt: Date,
  ): Promise<'owner' | 'wait'> {
    const nowEpoch = Math.floor(claimAt.getTime() / 1_000);
    try {
      await sendDocument(
        dependencies.client,
        new PutCommand({
          TableName: dependencies.tableName,
          Item: {
            PK: workspacePartition(workspaceId),
            SK: `AWS_QUERY_LOCK#${validateDigest(digest)}`,
            ownerRequestId: requestId,
            expiresAtEpoch: nowEpoch + QUERY_LOCK_SECONDS,
          },
          ConditionExpression:
            'attribute_not_exists(PK) OR expiresAtEpoch <= :now',
          ExpressionAttributeValues: { ':now': nowEpoch },
        }),
      );
      return 'owner';
    } catch (error) {
      if (isConditionalFailure(error)) return 'wait';
      throw error;
    }
  }

  async function releaseQueryExecution(
    workspaceId: WorkspaceId,
    digest: string,
    requestId: string,
  ): Promise<void> {
    try {
      await sendDocument(
        dependencies.client,
        new DeleteCommand({
          TableName: dependencies.tableName,
          Key: {
            PK: workspacePartition(workspaceId),
            SK: `AWS_QUERY_LOCK#${validateDigest(digest)}`,
          },
          ConditionExpression: 'ownerRequestId = :requestId',
          ExpressionAttributeValues: { ':requestId': requestId },
        }),
      );
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
    }
  }

  async function waitForCachedCostResult(
    workspaceId: WorkspaceId,
    digest: string,
  ): Promise<CompleteCostExplorerResult | undefined> {
    let elapsed = 0;
    while (elapsed < QUERY_WAIT_MILLISECONDS) {
      const delay = Math.min(
        200 + Math.floor(random() * 300),
        QUERY_WAIT_MILLISECONDS - elapsed,
      );
      await sleep(delay);
      elapsed += delay;
      const cached = await getCachedCostResult(workspaceId, digest, now());
      if (cached) return cached;
    }
    return undefined;
  }

  return {
    getCachedCostResult,
    putCachedCostResult,
    claimManualRefresh,
    getManualRefreshCooldown,
    claimQueryExecution,
    releaseQueryExecution,
    waitForCachedCostResult,
  };
}
