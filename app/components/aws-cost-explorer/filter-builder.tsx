'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CostExplorerExpression,
  CostDimensionRequest,
} from '@cashight/domain/aws-cost-explorer';

import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { SelectField } from './fields';
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
    <SpaceBetween size="xs">
      <Button
        iconName={open ? 'caret-up-filled' : 'caret-down-filled'}
        iconAlign="right"
        disabled={!canLoad}
        ariaLabel={`${open ? 'Close' : 'Choose'} ${label || 'filter'} values`}
        ariaExpanded={open}
        onClick={() => setOpen(!open)}
      >
        {card.values.length > 0 ? `${card.values.length} selected` : 'Choose values'}
      </Button>
      {open ? (
        <Box padding="s">
          <SpaceBetween size="xs">
            <FormField label="Search values">
              <Input
                ariaLabel={`Search ${label} values`}
                value={search}
                type="search"
                onChange={({ detail }) => setSearch(detail.value)}
                placeholder={`Search ${label.toLowerCase()}`}
              />
            </FormField>
            {card.values.length > 0 && (
              <Box variant="small" color="text-body-secondary">
                Selected: {card.values.map((value) => displayFilterValue(card, value)).join(', ')}
              </Box>
            )}
            <div style={{ maxHeight: 192, overflowY: 'auto' }} aria-live="polite">
              <SpaceBetween size="xxs">
                {visibleValues.map((value) => (
                  <Checkbox
                    key={value}
                    checked={card.values.includes(value)}
                    onChange={({ detail }) => toggleValue(value, detail.checked)}
                  >
                    {displayFilterValue(card, value)}
                  </Checkbox>
                ))}
              </SpaceBetween>
              {!loading && visibleValues.length === 0 && (
                <Box color="text-body-secondary" padding={{ vertical: 's' }}>No values found.</Box>
              )}
            </div>
            {loading && <StatusIndicator type="loading">Loading values…</StatusIndicator>}
            {error && (
              <div role="alert">
                <StatusIndicator type="error">{error}</StatusIndicator>
              </div>
            )}
            {nextCursor && (
              <Button disabled={loading} onClick={() => void loadValues(nextCursor, true)}>
                Load more values
              </Button>
            )}
          </SpaceBetween>
        </Box>
      ) : null}
    </SpaceBetween>
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
    <section aria-labelledby="cost-filter-heading">
      <SpaceBetween size="s">
        <Header
          variant="h3"
          description="Values within a filter use OR; filter cards use AND."
          actions={
            <Button
              iconName="add-plus"
              onClick={() => {
                publish([
                  ...cards,
                  { id: nextIdRef.current++, type: 'DIMENSION', key: 'SERVICE', values: [] },
                ]);
              }}
            >
              Add filter
            </Button>
          }
        >
          <span id="cost-filter-heading">Filters</span>
        </Header>

        {cards.map((card, index) => (
          <Container key={card.id} variant="stacked">
            <ColumnLayout columns={4}>
              <SelectField
                label={`Filter ${index + 1} category`}
                value={card.type}
                options={[
                  { value: 'DIMENSION', label: 'Dimension' },
                  { value: 'TAG', label: 'Tag' },
                  { value: 'COST_CATEGORY', label: 'Cost category' },
                ]}
                onChange={(type: FilterType) =>
                  updateCard(card.id, { type, key: type === 'DIMENSION' ? 'SERVICE' : '', values: [] })
                }
              />
              {card.type === 'DIMENSION' ? (
                <SelectField
                  label={`Filter ${index + 1} dimension`}
                  value={card.key}
                  options={COST_FILTER_DIMENSIONS.map((dimension) => ({ value: dimension.key, label: dimension.label }))}
                  onChange={(key) => updateCard(card.id, { key, values: [] })}
                />
              ) : (
                <FormField label={card.type === 'TAG' ? 'Tag key' : 'Cost category name'}>
                  <Input
                    ariaLabel={`Filter ${index + 1} key`}
                    value={card.key}
                    onChange={({ detail }) => updateCard(card.id, { key: detail.value, values: [] })}
                  />
                </FormField>
              )}
              <FormField label="Values">
                <ValueSelector
                  key={`${card.type}:${card.key}`}
                  card={card}
                  timePeriod={timePeriod}
                  billingViewArn={billingViewArn}
                  onValuesChange={(values) => updateCard(card.id, { values })}
                />
              </FormField>
              <FormField label={<span className="visually-hidden">Remove</span>}>
                <Button
                  variant="icon"
                  iconName="remove"
                  ariaLabel={`Remove filter ${index + 1}`}
                  onClick={() => publish(cards.filter((item) => item.id !== card.id))}
                />
              </FormField>
            </ColumnLayout>
          </Container>
        ))}
      </SpaceBetween>
    </section>
  );
}
