import { apiFetch } from '@/frontend/api/client';
import { StatementsListResponseSchema, type StatementListItem } from '@/frontend/api/contracts';
import { getPublicConfig } from '@/frontend/auth/config';
import type { BankCode } from '@/lib/banks';
import type { StatementRow } from '@/app/components/statements-table';

/** Publish only a complete, validated metadata snapshot, never a partial page. */
export async function loadStatementHistory(signal?: AbortSignal): Promise<StatementListItem[]> {
  const items = new Map<string, StatementListItem>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    signal?.throwIfAborted();
    const url = new URL(`${getPublicConfig().apiBaseUrl}/statements`);
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const response = await apiFetch(url.toString(), { signal });
    const page = StatementsListResponseSchema.parse(await response.json());
    signal?.throwIfAborted();
    for (const item of page.items) items.set(item.statementId, item);
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error('Statement history returned a repeated cursor. Please retry.');
      seen.add(cursor);
    }
  } while (cursor !== null);
  return [...items.values()];
}

export function statementRows(items: StatementListItem[], bank: BankCode): StatementRow[] {
  return items.filter((item) => item.bank === bank).map((item) => {
    const [year, month] = item.statementDate.split('-').map(Number);
    return {
      key: item.statementId, bank: item.bank, cardLast4: item.cardLast4,
      year, month, totalSpend: item.totalSpend, uploadedAt: item.uploadedAt,
    };
  });
}
