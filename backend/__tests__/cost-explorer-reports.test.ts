import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { describe, expect, it } from 'vitest';

import {
  SavedReportError,
  createSavedCostReportStore,
} from '../functions/cost-explorer-api/reports';

type Item = { PK: string; SK: string; [key: string]: unknown };
type Command = { constructor: { name: string }; input: Record<string, unknown> };

function key(item: Pick<Item, 'PK' | 'SK'>): string {
  return `${item.PK}|${item.SK}`;
}

function conditionalFailure(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({ message: 'condition failed', $metadata: {} });
}

class MemoryReportClient {
  readonly items = new Map<string, Item>();

  private conditionAllows(
    condition: string | undefined,
    existing: Item | undefined,
    values: Record<string, unknown>,
  ): boolean {
    if (!condition) return true;
    if (condition === 'attribute_not_exists(PK)') return existing === undefined;
    if (condition === 'attribute_exists(PK)') return existing !== undefined;
    if (condition === 'reportId = :reportId') {
      return existing?.reportId === values[':reportId'];
    }
    if (condition === 'attribute_not_exists(PK) OR reportId = :reportId') {
      return existing === undefined || existing.reportId === values[':reportId'];
    }
    throw new Error(`Unsupported condition ${condition}`);
  }

  async send(command: Command): Promise<Record<string, unknown>> {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
      const found = this.items.get(key(input.Key as Item));
      return { Item: found ? structuredClone(found) : undefined };
    }
    if (command.constructor.name === 'QueryCommand') {
      const values = input.ExpressionAttributeValues as Record<string, string>;
      return {
        Items: [...this.items.values()]
          .filter(
            (item) =>
              item.PK === values[':pk'] && item.SK.startsWith(values[':prefix']),
          )
          .map((item) => structuredClone(item)),
      };
    }
    if (command.constructor.name === 'TransactWriteCommand') {
      const next = new Map(this.items);
      const actions = input.TransactItems as Array<{
        Put?: Record<string, unknown>;
        Delete?: Record<string, unknown>;
      }>;
      for (const action of actions) {
        const operation = action.Put ?? action.Delete!;
        const target = (action.Put?.Item ?? action.Delete?.Key) as Item;
        const existing = next.get(key(target));
        if (
          !this.conditionAllows(
            operation.ConditionExpression as string | undefined,
            existing,
            (operation.ExpressionAttributeValues ?? {}) as Record<string, unknown>,
          )
        ) {
          throw conditionalFailure();
        }
      }
      for (const action of actions) {
        if (action.Put) {
          const item = structuredClone(action.Put.Item as Item);
          next.set(key(item), item);
        } else if (action.Delete) {
          next.delete(key(action.Delete.Key as Item));
        }
      }
      this.items.clear();
      for (const [itemKey, item] of next) this.items.set(itemKey, item);
      return {};
    }
    throw new Error(`Unsupported command ${command.constructor.name}`);
  }
}

const request: CostExplorerReportRequest = {
  mode: 'STANDARD',
  timePeriod: { start: '2026-01-01', end: '2026-08-01' },
  granularity: 'MONTHLY',
  metric: 'UnblendedCost',
  groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
  chartStyle: 'STACK',
  showForecast: false,
  showOnlyUntagged: false,
  showOnlyUncategorized: false,
};

function setup() {
  const client = new MemoryReportClient();
  const ids = [
    '51ae8b2c-d0d4-4a49-87ee-662083d133f6',
    '4a012d87-48a0-4dc5-9224-788696aecc4a',
  ];
  const store = createSavedCostReportStore({
    client,
    tableName: 'cashight-test',
    now: () => new Date('2026-08-09T12:00:00.000Z'),
    randomUUID: () => ids.shift()!,
  });
  return { client, store };
}

describe('saved Cost Explorer reports', () => {
  it('creates UUID reports in the workspace partition and lists them deterministically', async () => {
    const { client, store } = setup();
    const second = await store.putSavedReport('primary', { name: '  Zebra  ', request });
    const first = await store.putSavedReport('primary', { name: 'alpha', request });

    expect(second.reportId).toBe('51ae8b2c-d0d4-4a49-87ee-662083d133f6');
    expect(second.name).toBe('Zebra');
    expect([...client.items.values()].find((item) => item.SK.startsWith('AWS_REPORT#'))?.PK)
      .toBe('WORKSPACE#primary');
    await expect(store.listSavedReports('primary')).resolves.toEqual([first, second]);
  });

  it('enforces trimmed 1-80 character names and validated requests', async () => {
    const { store } = setup();

    await expect(store.putSavedReport('primary', { name: '   ', request })).rejects.toThrow();
    await expect(
      store.putSavedReport('primary', { name: 'x'.repeat(81), request }),
    ).rejects.toThrow();
    await expect(
      store.putSavedReport('primary', {
        name: 'Invalid',
        request: { ...request, groupBy: Array(3).fill(request.groupBy[0]) },
      }),
    ).rejects.toThrow();
  });

  it('rejects case-insensitive duplicate names', async () => {
    const { store } = setup();
    await store.putSavedReport('primary', { name: 'Monthly services', request });

    await expect(
      store.putSavedReport('primary', { name: ' monthly SERVICES ', request }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_REPORT_NAME' });
  });

  it('replaces and renames an existing report while preserving createdAt', async () => {
    const { store } = setup();
    const created = await store.putSavedReport('primary', { name: 'Original', request });
    const updated = await store.putSavedReport('primary', {
      reportId: created.reportId,
      name: 'Renamed',
      request: { ...request, chartStyle: 'LINE' },
    });

    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBe('2026-08-09T12:00:00.000Z');
    expect(updated.name).toBe('Renamed');
    expect(updated.request.chartStyle).toBe('LINE');
    await expect(store.listSavedReports('primary')).resolves.toEqual([updated]);
  });

  it('does not delete missing or foreign-workspace reports', async () => {
    const { client, store } = setup();
    const reportId = '51ae8b2c-d0d4-4a49-87ee-662083d133f6';
    const foreign: Item = {
      PK: 'WORKSPACE#other',
      SK: `AWS_REPORT#${reportId}`,
      reportId,
      name: 'Foreign',
      request,
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:00:00.000Z',
    };
    client.items.set(key(foreign), foreign);

    await expect(store.deleteSavedReport('primary', reportId)).resolves.toBe(false);
    expect(client.items.has(key(foreign))).toBe(true);
    await expect(
      store.deleteSavedReport('primary', 'not-a-uuid'),
    ).rejects.toThrow();
  });

  it('deletes the owned definition and its name reservation', async () => {
    const { client, store } = setup();
    const created = await store.putSavedReport('primary', { name: 'Delete me', request });

    await expect(store.deleteSavedReport('primary', created.reportId)).resolves.toBe(true);
    await expect(store.listSavedReports('primary')).resolves.toEqual([]);
    expect([...client.items.values()]).toHaveLength(0);
  });

  it('rejects invalid persisted report JSON rather than returning it', async () => {
    const { client, store } = setup();
    const invalid: Item = {
      PK: 'WORKSPACE#primary',
      SK: 'AWS_REPORT#51ae8b2c-d0d4-4a49-87ee-662083d133f6',
      reportId: '51ae8b2c-d0d4-4a49-87ee-662083d133f6',
      name: '',
    };
    client.items.set(key(invalid), invalid);

    await expect(store.listSavedReports('primary')).rejects.toBeInstanceOf(
      SavedReportError,
    );
  });
});
