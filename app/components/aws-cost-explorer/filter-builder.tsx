'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type {
  CostExplorerExpression,
  CostDimensionRequest,
} from '@cashight/domain/aws-cost-explorer';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/frontend/api/client';
import { CostDimensionValuesResponseSchema } from '@/frontend/api/contracts';
import { getPublicConfig } from '@/frontend/auth/config';

type FilterType = 'DIMENSION' | 'TAG' | 'COST_CATEGORY';

interface FilterCardState {
  id: number;
  type: FilterType;
  key: string;
  values: string[];
}

export const COST_FILTER_DIMENSIONS = [
  { key: 'OPERATION', label: 'API operation' },
  { key: 'AZ', label: 'Availability Zone' },
  { key: 'BILLING_ENTITY', label: 'Billing entity' },
  { key: 'RECORD_TYPE', label: 'Charge type' },
  { key: 'INSTANCE_TYPE', label: 'Instance type' },
  { key: 'LEGAL_ENTITY_NAME', label: 'Legal entity' },
  { key: 'LINKED_ACCOUNT', label: 'Linked account' },
  { key: 'PLATFORM', label: 'Platform' },
  { key: 'PURCHASE_TYPE', label: 'Purchase option' },
  { key: 'REGION', label: 'Region' },
  { key: 'RESOURCE_ID', label: 'Resource' },
  { key: 'SERVICE', label: 'Service' },
  { key: 'TENANCY', label: 'Tenancy' },
  { key: 'USAGE_TYPE', label: 'Usage type' },
  { key: 'USAGE_TYPE_GROUP', label: 'Usage type group' },
] as const;

const selectClassName =
  'h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-theme-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300';

function dimensionLabel(key: string): string {
  return COST_FILTER_DIMENSIONS.find((item) => item.key === key)?.label ?? key;
}

function displayFilterValue(card: FilterCardState, value: string): string {
  if (card.type !== 'DIMENSION' || card.key !== 'LINKED_ACCOUNT') return value;
  const digits = value.match(/\d{4,}/)?.[0];
  return `Linked account •••• ${digits?.slice(-4) ?? '••••'}`;
}

function expressionLeaf(card: FilterCardState): CostExplorerExpression | null {
  if (!card.key || card.values.length === 0) return null;
  const leaf = {
    Key: card.key,
    Values: card.values,
    MatchOptions: ['EQUALS' as const],
  };
  if (card.type === 'DIMENSION') return { Dimensions: leaf };
  if (card.type === 'TAG') return { Tags: leaf };
  return { CostCategories: leaf };
}

function expressionFromCards(
  cards: FilterCardState[],
): CostExplorerExpression | undefined {
  const expressions = cards.flatMap((card) => {
    const expression = expressionLeaf(card);
    return expression ? [expression] : [];
  });
  if (expressions.length === 0) return undefined;
  return expressions.length === 1 ? expressions[0] : { And: expressions };
}

function cardsFromExpression(
  expression: CostExplorerExpression | undefined,
): FilterCardState[] {
  const expressions = expression && 'And' in expression
    ? expression.And
    : expression
      ? [expression]
      : [];
  let id = 0;
  return expressions.flatMap<FilterCardState>((item) => {
    if ('Dimensions' in item) {
      return [{ id: ++id, type: 'DIMENSION' as const, key: item.Dimensions.Key, values: item.Dimensions.Values }];
    }
    if ('Tags' in item) {
      return [{ id: ++id, type: 'TAG' as const, key: item.Tags.Key, values: item.Tags.Values }];
    }
    if ('CostCategories' in item) {
      return [{ id: ++id, type: 'COST_CATEGORY' as const, key: item.CostCategories.Key, values: item.CostCategories.Values }];
    }
    return [];
  });
}

function ValueSelector({
  card,
  timePeriod,
  billingViewArn,
  onValuesChange,
}: {
  card: FilterCardState;
  timePeriod: { start: string; end: string };
  billingViewArn?: string;
  onValuesChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const label = card.type === 'DIMENSION' ? dimensionLabel(card.key) : card.key;
  const canLoad = Boolean(card.key);

  const loadValues = useCallback(
    async (cursor?: string, append = false) => {
      const generation = ++requestGenerationRef.current;
      setLoading(true);
      setError(null);
      try {
        const request: CostDimensionRequest = {
          type: card.type,
          key: card.key,
          timePeriod,
          ...(billingViewArn ? { billingViewArn } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(cursor ? { cursor } : {}),
        };
        const { apiBaseUrl } = getPublicConfig();
        const response = await apiFetch(
          `${apiBaseUrl}/aws/cost-explorer/dimensions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          },
        );
        const data = CostDimensionValuesResponseSchema.parse(await response.json());
        if (requestGenerationRef.current !== generation) return;
        setItems((current) => {
          const values = append
            ? [...current, ...data.items.map((item) => item.value)]
            : data.items.map((item) => item.value);
          return [...new Set(values)];
        });
        setNextCursor(data.nextCursor);
      } catch (loadError) {
        if (requestGenerationRef.current !== generation) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load filter values.',
        );
      } finally {
        if (requestGenerationRef.current === generation) setLoading(false);
      }
    },
    [billingViewArn, card.key, card.type, search, timePeriod],
  );

  useEffect(() => {
    if (!open || !canLoad) return;
    const timeout = window.setTimeout(
      () => void loadValues(undefined, false),
      search ? 250 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [canLoad, loadValues, open, search]);

  const visibleValues = [...new Set([...card.values, ...items])];
  const toggleValue = (value: string, checked: boolean) => {
    onValuesChange(
      checked
        ? [...new Set([...card.values, value])]
        : card.values.filter((current) => current !== value),
    );
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          disabled={!canLoad}
          aria-label={`${open ? 'Close' : 'Choose'} ${label || 'filter'} values`}
        >
          <span className="truncate">
            {card.values.length > 0
              ? `${card.values.length} selected`
              : 'Choose values'}
          </span>
          {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-25 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <label className="block space-y-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          <span>Search values</span>
          <Input
            aria-label={`Search ${label} values`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
          />
        </label>
        {card.values.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Selected:{' '}
            {card.values
              .map((value) => displayFilterValue(card, value))
              .join(', ')}
          </p>
        )}
        <div className="max-h-48 space-y-1 overflow-y-auto" aria-live="polite">
          {visibleValues.map((value, index) => {
            const id = `cost-filter-${card.id}-${index}`;
            return (
              <label
                key={value}
                htmlFor={id}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
              >
                <Checkbox
                  id={id}
                  checked={card.values.includes(value)}
                  onCheckedChange={(checked) => toggleValue(value, checked === true)}
                />
                <span className="break-all">
                  {displayFilterValue(card, value)}
                </span>
              </label>
            );
          })}
          {!loading && visibleValues.length === 0 && (
            <p className="px-2 py-3 text-sm text-gray-500">No values found.</p>
          )}
        </div>
        {loading && <p className="text-xs text-gray-500">Loading values…</p>}
        {error && <p role="alert" className="text-xs text-error-600">{error}</p>}
        {nextCursor && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-11"
            disabled={loading}
            onClick={() => void loadValues(nextCursor, true)}
          >
            Load more values
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FilterBuilder({
  value,
  timePeriod,
  billingViewArn,
  onChange,
}: {
  value: CostExplorerExpression | undefined;
  timePeriod: { start: string; end: string };
  billingViewArn?: string;
  onChange: (expression: CostExplorerExpression | undefined) => void;
}) {
  const [cards, setCards] = useState<FilterCardState[]>(() =>
    cardsFromExpression(value),
  );
  const nextIdRef = useRef(Math.max(0, ...cards.map((card) => card.id)) + 1);
  const previousValueRef = useRef(JSON.stringify(value));
  const lastEmittedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized === previousValueRef.current) return;
    previousValueRef.current = serialized;
    if (serialized === lastEmittedRef.current) return;
    const nextCards = cardsFromExpression(value);
    setCards(nextCards);
    nextIdRef.current = Math.max(0, ...nextCards.map((card) => card.id)) + 1;
  }, [value]);

  const publish = (nextCards: FilterCardState[]) => {
    const expression = expressionFromCards(nextCards);
    lastEmittedRef.current = JSON.stringify(expression);
    setCards(nextCards);
    onChange(expression);
  };

  const updateCard = (id: number, update: Partial<FilterCardState>) => {
    publish(
      cards.map((card) => (card.id === id ? { ...card, ...update } : card)),
    );
  };

  return (
    <section className="space-y-3" aria-labelledby="cost-filter-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="cost-filter-heading" className="text-sm font-semibold text-gray-900 dark:text-white/90">
            Filters
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Values within a filter use OR; filter cards use AND.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            publish([
              ...cards,
              {
                id: nextIdRef.current++,
                type: 'DIMENSION',
                key: 'SERVICE',
                values: [],
              },
            ]);
          }}
        >
          <Plus aria-hidden />
          Add filter
        </Button>
      </div>

      {cards.map((card, index) => (
        <div
          key={card.id}
          className="grid gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
        >
          <label className="space-y-1 text-xs font-medium text-gray-700 dark:text-gray-300">
            <span>Category</span>
            <select
              aria-label={`Filter ${index + 1} category`}
              className={selectClassName}
              value={card.type}
              onChange={(event) => {
                const type = event.target.value as FilterType;
                updateCard(card.id, {
                  type,
                  key: type === 'DIMENSION' ? 'SERVICE' : '',
                  values: [],
                });
              }}
            >
              <option value="DIMENSION">Dimension</option>
              <option value="TAG">Tag</option>
              <option value="COST_CATEGORY">Cost category</option>
            </select>
          </label>

          {card.type === 'DIMENSION' ? (
            <label className="space-y-1 text-xs font-medium text-gray-700 dark:text-gray-300">
              <span>Dimension</span>
              <select
                aria-label={`Filter ${index + 1} dimension`}
                className={selectClassName}
                value={card.key}
                onChange={(event) =>
                  updateCard(card.id, { key: event.target.value, values: [] })
                }
              >
                {COST_FILTER_DIMENSIONS.map((dimension) => (
                  <option key={dimension.key} value={dimension.key}>
                    {dimension.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="space-y-1 text-xs font-medium text-gray-700 dark:text-gray-300">
              <span>{card.type === 'TAG' ? 'Tag key' : 'Cost category name'}</span>
              <Input
                aria-label={`Filter ${index + 1} key`}
                value={card.key}
                onChange={(event) =>
                  updateCard(card.id, { key: event.target.value, values: [] })
                }
              />
            </label>
          )}

          <div className="space-y-1 text-xs font-medium text-gray-700 dark:text-gray-300">
            <span className="block">Values</span>
            <ValueSelector
              key={`${card.type}:${card.key}`}
              card={card}
              timePeriod={timePeriod}
              billingViewArn={billingViewArn}
              onValuesChange={(values) => updateCard(card.id, { values })}
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 self-end text-gray-500 sm:mb-0.5"
            aria-label={`Remove filter ${index + 1}`}
            onClick={() => publish(cards.filter((item) => item.id !== card.id))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
    </section>
  );
}
