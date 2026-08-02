import fs from 'node:fs/promises';
import path from 'node:path';

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { localDataDir } from './paths';

/**
 * JSON-file-backed stand-in for `DynamoDBDocumentClient`, used only by the
 * local dev stack.
 *
 * The point of emulating the *client* rather than reimplementing
 * `backend/shared/metadata.ts` against a local store is fidelity: the dev
 * server runs the exact production metadata code, including the conditional
 * writes that give the upload pipeline its idempotency
 * (`putIdempotencyRecord`) and its state-machine guarantees
 * (`transitionJobState`). A parallel implementation would drift.
 *
 * Only the expression forms the codebase actually uses are supported; anything
 * else throws loudly rather than silently doing the wrong thing.
 */

export interface TableItem {
  PK: string;
  SK: string;
  [attribute: string]: unknown;
}

interface AnyCommand {
  constructor: { name: string };
  input: Record<string, unknown>;
}

type Values = Record<string, unknown>;
type Names = Record<string, string>;

// ── Expression parsing ────────────────────────────────────────────────────────

/** Resolve `#alias` through ExpressionAttributeNames; plain names pass through. */
function resolveName(token: string, names: Names): string {
  const trimmed = token.trim();
  if (!trimmed.startsWith('#')) return trimmed;
  const resolved = names[trimmed];
  if (resolved === undefined) {
    throw new Error(`Unmapped expression attribute name: ${trimmed}`);
  }
  return resolved;
}

/** Resolve a `:placeholder` through ExpressionAttributeValues. */
function resolveValue(token: string, values: Values): unknown {
  const trimmed = token.trim();
  if (!trimmed.startsWith(':')) {
    throw new Error(`Expected a value placeholder, got: ${trimmed}`);
  }
  if (!(trimmed in values)) {
    throw new Error(`Unmapped expression attribute value: ${trimmed}`);
  }
  return values[trimmed];
}

/**
 * Evaluate a ConditionExpression against an item (`undefined` when the item
 * does not exist). Supports `attribute_exists(x)`, `attribute_not_exists(x)`
 * and `x = :v`, combined with AND — which is the full set in use.
 */
export function evaluateCondition(
  expression: string,
  item: TableItem | undefined,
  names: Names,
  values: Values,
): boolean {
  return expression
    .split(/\s+AND\s+/i)
    .map((clause) => clause.trim())
    .every((clause) => {
      const exists = /^attribute_exists\(([^)]+)\)$/i.exec(clause);
      if (exists) return item?.[resolveName(exists[1], names)] !== undefined;

      const notExists = /^attribute_not_exists\(([^)]+)\)$/i.exec(clause);
      if (notExists) return item?.[resolveName(notExists[1], names)] === undefined;

      const equality = /^([#\w.]+)\s*=\s*(:\w+)$/.exec(clause);
      if (equality) {
        return item?.[resolveName(equality[1], names)] === resolveValue(equality[2], values);
      }

      throw new Error(`Unsupported ConditionExpression clause: ${clause}`);
    });
}

/**
 * Apply a `SET a = :v, b = if_not_exists(b, :v)` UpdateExpression, returning a
 * new item. REMOVE / ADD / DELETE are not used by this codebase and throw.
 */
export function applyUpdateExpression(
  expression: string,
  item: TableItem,
  names: Names,
  values: Values,
): TableItem {
  // [\s\S] rather than the `s` flag — tsconfig targets ES2017.
  const setClause = /^\s*SET\s+([\s\S]*)$/i.exec(expression);
  if (!setClause) {
    throw new Error(`Unsupported UpdateExpression (only SET is supported): ${expression}`);
  }

  const updated: TableItem = { ...item };
  // Split on commas that are not inside if_not_exists(...) parentheses.
  const assignments = setClause[1].split(/,(?![^(]*\))/);

  for (const rawAssignment of assignments) {
    const assignment = rawAssignment.trim();
    if (!assignment) continue;

    const [rawTarget, ...rest] = assignment.split('=');
    const target = resolveName(rawTarget, names);
    const rawSource = rest.join('=').trim();

    const ifNotExists = /^if_not_exists\(\s*([#\w.]+)\s*,\s*(:\w+)\s*\)$/i.exec(rawSource);
    if (ifNotExists) {
      const existing = updated[resolveName(ifNotExists[1], names)];
      updated[target] =
        existing === undefined ? resolveValue(ifNotExists[2], values) : existing;
      continue;
    }

    updated[target] = resolveValue(rawSource, values);
  }

  return updated;
}

// ── Table file ────────────────────────────────────────────────────────────────

function tableFile(): string {
  return path.join(localDataDir(), 'table.json');
}

async function readTable(): Promise<TableItem[]> {
  try {
    const raw = await fs.readFile(tableFile(), 'utf8');
    const parsed = JSON.parse(raw) as { items?: TableItem[] };
    return parsed.items ?? [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeTable(items: TableItem[]): Promise<void> {
  const sorted = [...items].sort(
    (a, b) => a.PK.localeCompare(b.PK) || a.SK.localeCompare(b.SK),
  );
  const file = tableFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash mid-write can't truncate the table.
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify({ items: sorted }, null, 2)}\n`);
  await fs.rename(temp, file);
}

/** Drop attributes whose value is `undefined`, matching `removeUndefinedValues`. */
function stripUndefined(item: Record<string, unknown>): TableItem {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined),
  ) as TableItem;
}

function keyMatches(item: TableItem, key: { PK: string; SK: string }): boolean {
  return item.PK === key.PK && item.SK === key.SK;
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Every operation runs through this promise chain. Node is single-threaded but
 * the read-modify-write cycle spans awaits, so without serialization two
 * concurrent conditional writes could both observe the pre-write state and
 * both succeed — exactly the race the conditions exist to prevent.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}

function conditionalCheckFailed(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });
}

async function handleCommand(command: AnyCommand): Promise<unknown> {
  const input = command.input;
  const names = (input.ExpressionAttributeNames as Names) ?? {};
  const values = (input.ExpressionAttributeValues as Values) ?? {};
  const items = await readTable();

  switch (command.constructor.name) {
    case 'GetCommand': {
      const key = input.Key as { PK: string; SK: string };
      return { Item: items.find((item) => keyMatches(item, key)) };
    }

    case 'PutCommand': {
      const incoming = stripUndefined(input.Item as Record<string, unknown>);
      const index = items.findIndex((item) => keyMatches(item, incoming));
      const existing = index >= 0 ? items[index] : undefined;

      if (
        typeof input.ConditionExpression === 'string' &&
        !evaluateCondition(input.ConditionExpression, existing, names, values)
      ) {
        throw conditionalCheckFailed();
      }

      if (index >= 0) items[index] = incoming;
      else items.push(incoming);
      await writeTable(items);
      return {};
    }

    case 'UpdateCommand': {
      const key = input.Key as { PK: string; SK: string };
      const index = items.findIndex((item) => keyMatches(item, key));
      const existing = index >= 0 ? items[index] : undefined;

      if (
        typeof input.ConditionExpression === 'string' &&
        !evaluateCondition(input.ConditionExpression, existing, names, values)
      ) {
        throw conditionalCheckFailed();
      }

      // DynamoDB upserts on UpdateItem when no condition rules it out.
      const base: TableItem = existing ?? { PK: key.PK, SK: key.SK };
      const updated = applyUpdateExpression(
        input.UpdateExpression as string,
        base,
        names,
        values,
      );

      if (index >= 0) items[index] = updated;
      else items.push(updated);
      await writeTable(items);
      return { Attributes: updated };
    }

    case 'DeleteCommand': {
      const key = input.Key as { PK: string; SK: string };
      await writeTable(items.filter((item) => !keyMatches(item, key)));
      return {};
    }

    case 'QueryCommand': {
      const condition = input.KeyConditionExpression as string;
      const partition = /PK\s*=\s*(:\w+)/.exec(condition);
      if (!partition) {
        throw new Error(`Unsupported KeyConditionExpression: ${condition}`);
      }
      const partitionKey = resolveValue(partition[1], values);
      const beginsWith = /begins_with\(\s*SK\s*,\s*(:\w+)\s*\)/.exec(condition);
      const prefix = beginsWith ? String(resolveValue(beginsWith[1], values)) : '';

      let matches = items
        .filter((item) => item.PK === partitionKey && item.SK.startsWith(prefix))
        .sort((a, b) => a.SK.localeCompare(b.SK));

      if (input.ScanIndexForward === false) matches.reverse();

      const startKey = input.ExclusiveStartKey as { PK: string; SK: string } | undefined;
      if (startKey) {
        const from = matches.findIndex((item) => keyMatches(item, startKey));
        matches = from >= 0 ? matches.slice(from + 1) : matches;
      }

      const limit = typeof input.Limit === 'number' ? input.Limit : matches.length;
      const page = matches.slice(0, limit);
      const hasMore = matches.length > page.length;
      const last = page[page.length - 1];

      return {
        Items: page,
        LastEvaluatedKey: hasMore && last ? { PK: last.PK, SK: last.SK } : undefined,
      };
    }

    default:
      throw new Error(`Unsupported DynamoDB command: ${command.constructor.name}`);
  }
}

/**
 * A `DynamoDBDocumentClient`-shaped object backed by `<LOCAL_DATA_DIR>/table.json`.
 * Cast because it implements only the `send` surface the backend uses.
 */
export function createLocalDynamoClient(): DynamoDBDocumentClient {
  return {
    send: (command: AnyCommand) => serialize(() => handleCommand(command)),
  } as unknown as DynamoDBDocumentClient;
}

/** Read the whole table — for inspection in tests and the `reset` script. */
export function readLocalTable(): Promise<TableItem[]> {
  return serialize(readTable);
}
