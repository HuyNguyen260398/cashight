'use client';

import { useMemo, useState } from 'react';
import {
  CostExplorerReportRequestSchema,
  type CostExplorerReportRequest,
  type SavedCostReport,
} from '@cashight/domain/aws-cost-explorer';
import {
  validateCostExplorerSemantics,
  type CostExplorerValidationIssue,
} from '@cashight/domain/aws-cost-canonical';

import { FilterBuilder, COST_FILTER_DIMENSIONS } from './filter-builder';
import { SavedReports } from './saved-reports';
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
import { DateField, SelectField } from './fields';
import { apiFetch } from '@/frontend/api/client';
import { CostBillingViewsResponseSchema } from '@/frontend/api/contracts';
import { getPublicConfig } from '@/frontend/auth/config';
import {
  createDefaultCostReportRequest,
  serializeCostReportSearch,
} from '@/frontend/lib/aws-cost-explorer-url';

type DateRangePreset =
  | 'CURRENT_MONTH'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_3_MONTHS'
  | 'LAST_6_MONTHS'
  | 'YEAR_TO_DATE'
  | 'CUSTOM';

type GroupDefinition = CostExplorerReportRequest['groupBy'][number];

interface BillingViewOption {
  arn: string;
  name: string;
}

export interface ReportParametersProps {
  initialRequest: CostExplorerReportRequest;
  granularDataEnabled: boolean;
  onApply: (request: CostExplorerReportRequest) => void;
  now?: Date;
  savedReports?: SavedCostReport[];
  reportsLoading?: boolean;
  reportsError?: { message: string } | null;
  onSaveReport?: (
    name: string,
    request: CostExplorerReportRequest,
    reportId?: string,
  ) => Promise<SavedCostReport>;
  onDeleteReport?: (reportId: string) => Promise<void>;
  compact?: boolean;
  /**
   * Chart style owned by the dashboard, so the graph's own toggle and this
   * select never disagree. Omit to keep the style purely local to the draft.
   */
  chartStyle?: CostExplorerReportRequest['chartStyle'];
  onChartStyleChange?: (style: CostExplorerReportRequest['chartStyle']) => void;
}

const metrics = [
  ['UnblendedCost', 'Unblended cost'],
  ['BlendedCost', 'Blended cost'],
  ['AmortizedCost', 'Amortized cost'],
  ['NetUnblendedCost', 'Net unblended cost'],
  ['NetAmortizedCost', 'Net amortized cost'],
  ['UsageQuantity', 'Usage quantity'],
  ['NormalizedUsageAmount', 'Normalized usage amount'],
] as const;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

function periodForPreset(
  preset: Exclude<DateRangePreset, 'CUSTOM'>,
  now: Date,
): CostExplorerReportRequest['timePeriod'] {
  const end = utcDate(now);
  let start: Date;
  if (preset === 'CURRENT_MONTH') {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  } else if (preset === 'LAST_7_DAYS') {
    start = subtractDays(end, 7);
  } else if (preset === 'LAST_30_DAYS') {
    start = subtractDays(end, 30);
  } else if (preset === 'LAST_3_MONTHS') {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, 1));
  } else if (preset === 'LAST_6_MONTHS') {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 6, 1));
  } else {
    start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  }
  if (start >= end) end.setUTCDate(end.getUTCDate() + 1);
  return { start: isoDate(start), end: isoDate(end) };
}

function inferPreset(
  period: CostExplorerReportRequest['timePeriod'],
  now: Date,
): DateRangePreset {
  const presets: Array<Exclude<DateRangePreset, 'CUSTOM'>> = [
    'CURRENT_MONTH',
    'LAST_7_DAYS',
    'LAST_30_DAYS',
    'LAST_3_MONTHS',
    'LAST_6_MONTHS',
    'YEAR_TO_DATE',
  ];
  return (
    presets.find((preset) => {
      const candidate = periodForPreset(preset, now);
      return candidate.start === period.start && candidate.end === period.end;
    }) ?? 'CUSTOM'
  );
}

function previousPeriod(
  period: CostExplorerReportRequest['timePeriod'],
): CostExplorerReportRequest['timePeriod'] {
  const start = Date.parse(`${period.start}T00:00:00.000Z`);
  const end = Date.parse(`${period.end}T00:00:00.000Z`);
  const duration = Math.max(24 * 60 * 60 * 1_000, end - start);
  return {
    start: isoDate(new Date(start - duration)),
    end: period.start,
  };
}

function closedMonthComparison(now: Date): {
  timePeriod: CostExplorerReportRequest['timePeriod'];
  comparisonTimePeriod: CostExplorerReportRequest['timePeriod'];
} {
  const currentMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const selectedStart = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 1, 1),
  );
  const comparisonStart = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 2, 1),
  );
  return {
    timePeriod: { start: isoDate(selectedStart), end: isoDate(currentMonth) },
    comparisonTimePeriod: {
      start: isoDate(comparisonStart),
      end: isoDate(selectedStart),
    },
  };
}

function GroupControl({
  index,
  group,
  onChange,
}: {
  index: number;
  group: GroupDefinition | null;
  onChange: (group: GroupDefinition | null) => void;
}) {
  const type = group?.type ?? 'NONE';
  return (
    <ColumnLayout columns={2}>
      <SelectField
        label={`Group ${index + 1} type`}
        value={type}
        options={[
          { value: 'NONE', label: 'None' },
          { value: 'DIMENSION', label: 'Dimension' },
          { value: 'TAG', label: 'Tag' },
          { value: 'COST_CATEGORY', label: 'Cost category' },
        ]}
        onChange={(nextType) => {
          if (nextType === 'NONE') onChange(null);
          else onChange({ type: nextType as GroupDefinition['type'], key: nextType === 'DIMENSION' ? 'SERVICE' : '' });
        }}
      />
      {group?.type === 'DIMENSION' ? (
        <SelectField
          label={`Group ${index + 1} key`}
          value={group.key}
          options={COST_FILTER_DIMENSIONS.map((dimension) => ({ value: dimension.key, label: dimension.label }))}
          onChange={(key) => onChange({ ...group, key })}
        />
      ) : (
        <FormField label={`Group ${index + 1} key`}>
          <Input
            ariaLabel={`Group ${index + 1} key`}
            disabled={!group}
            value={group?.key ?? ''}
            placeholder={group?.type === 'TAG' ? 'Tag key' : group?.type === 'COST_CATEGORY' ? 'Cost category name' : 'No group'}
            onChange={({ detail }) => group && onChange({ ...group, key: detail.value })}
          />
        </FormField>
      )}
    </ColumnLayout>
  );
}

function IssueList({ issues }: { issues: CostExplorerValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div aria-live="polite">
      <SpaceBetween size="xxs">
        {issues.map((issue, index) => (
          <div key={`${issue.path}:${issue.code}:${index}`} role={issue.severity === 'ERROR' ? 'alert' : 'status'}>
            <StatusIndicator type={issue.severity === 'ERROR' ? 'error' : 'warning'}>{issue.message}</StatusIndicator>
          </div>
        ))}
      </SpaceBetween>
    </div>
  );
}

function writeReportUrl(request: CostExplorerReportRequest): void {
  const url = new URL(window.location.href);
  url.search = serializeCostReportSearch(request).toString();
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function ReportParameters({
  initialRequest,
  granularDataEnabled,
  onApply,
  now = new Date(),
  savedReports,
  reportsLoading = false,
  reportsError = null,
  onSaveReport,
  onDeleteReport,
  compact = false,
  chartStyle,
  onChartStyleChange,
}: ReportParametersProps) {
  const [draft, setDraft] = useState<CostExplorerReportRequest>(initialRequest);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() =>
    inferPreset(initialRequest.timePeriod, now),
  );
  const [comparisonPreset, setComparisonPreset] = useState<
    'MONTH_TO_MONTH' | 'CUSTOM'
  >('CUSTOM');
  const [billingViews, setBillingViews] = useState<BillingViewOption[]>([]);
  const [billingViewsLoading, setBillingViewsLoading] = useState(false);
  const [billingViewsLoaded, setBillingViewsLoaded] = useState(false);
  const [billingViewsError, setBillingViewsError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  /**
   * The graph's own toggle can change the style without an Apply. When the
   * dashboard owns the value, it wins over the draft — otherwise applying an
   * unrelated edit here would silently revert the chart.
   */
  const effectiveDraft = chartStyle ? { ...draft, chartStyle } : draft;

  const validation = useMemo(
    () =>
      validateCostExplorerSemantics(draft, {
        granularDataEnabled,
        currentDate: isoDate(utcDate(now)),
      }),
    [draft, granularDataEnabled, now],
  );
  const forecastDisabled =
    draft.mode !== 'STANDARD' || draft.groupBy.length > 0;
  const forecastMessage = draft.groupBy.length > 0
    ? 'Forecast values are unavailable for grouped reports.'
    : 'Forecast values are available only for standard reports.';
  const forecastMessageIsValidationIssue = validation.issues.some(
    (issue) => issue.message === forecastMessage,
  );

  const loadBillingViews = async () => {
    if (billingViewsLoaded || billingViewsLoading) return;
    setBillingViewsLoading(true);
    setBillingViewsError(null);
    try {
      const { apiBaseUrl } = getPublicConfig();
      const response = await apiFetch(
        `${apiBaseUrl}/aws/cost-explorer/dimensions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'BILLING_VIEW' }),
        },
      );
      const data = CostBillingViewsResponseSchema.parse(await response.json());
      setBillingViews(data.billingViews);
      setBillingViewsLoaded(true);
    } catch (error) {
      setBillingViewsError(
        error instanceof Error ? error.message : 'Could not load billing views.',
      );
    } finally {
      setBillingViewsLoading(false);
    }
  };

  const updateGroup = (index: number, group: GroupDefinition | null) => {
    const slots: Array<GroupDefinition | null> = [
      draft.groupBy[0] ?? null,
      draft.groupBy[1] ?? null,
    ];
    slots[index] = group;
    const groupBy = slots.filter((item): item is GroupDefinition => item !== null);
    setDraft((current) => ({
      ...current,
      groupBy,
      ...(groupBy.length > 0 && current.showForecast
        ? { showForecast: false }
        : {}),
    }));
  };

  const apply = () => {
    const parsed = CostExplorerReportRequestSchema.safeParse(effectiveDraft);
    if (!parsed.success || !validation.valid) return;
    writeReportUrl(parsed.data);
    onApply(parsed.data);
  };

  const copyLink = async () => {
    const parsed = CostExplorerReportRequestSchema.safeParse(effectiveDraft);
    if (!parsed.success || !validation.valid) {
      setCopyStatus('Fix report errors before copying a link.');
      return;
    }
    const url = new URL(window.location.href);
    url.search = serializeCostReportSearch(parsed.data).toString();
    await navigator.clipboard.writeText(url.toString());
    setCopyStatus('Report link copied.');
  };

  const reset = () => {
    const request = createDefaultCostReportRequest(now);
    setDraft(request);
    setDatePreset('LAST_6_MONTHS');
    setComparisonPreset('CUSTOM');
    setCopyStatus(null);
  };

  const setLoadedReport = (request: CostExplorerReportRequest) => {
    setDraft(request);
    setDatePreset(inferPreset(request.timePeriod, now));
    setComparisonPreset('CUSTOM');
    setCopyStatus(null);
  };

  const columns = compact ? 1 : 4;
  const setStart = (start: string) => {
    setDatePreset('CUSTOM');
    setDraft((current) => ({ ...current, timePeriod: { ...current.timePeriod, start } }));
  };
  const setEnd = (end: string) => {
    setDatePreset('CUSTOM');
    setDraft((current) => ({ ...current, timePeriod: { ...current.timePeriod, end } }));
  };
  const setComparison = (key: 'start' | 'end', value: string) => {
    setComparisonPreset('CUSTOM');
    setDraft((current) => ({
      ...current,
      comparisonTimePeriod: { ...current.comparisonTimePeriod!, [key]: value },
    }));
  };
  const billingViewOptions = [
    { value: '', label: 'All billing data' },
    ...(draft.billingViewArn && !billingViews.some((view) => view.arn === draft.billingViewArn)
      ? [{ value: draft.billingViewArn, label: 'Current billing view' }]
      : []),
    ...billingViews.map((view) => ({ value: view.arn, label: view.name })),
  ];

  return (
    <Container header={<Header variant="h2">Report parameters</Header>}>
      <SpaceBetween size="l">
        <section aria-label="Date and report mode">
          <ColumnLayout columns={columns}>
            <SelectField<DateRangePreset>
              label="Date range"
              value={datePreset}
              options={[
                { value: 'CURRENT_MONTH', label: 'Current month' },
                { value: 'LAST_7_DAYS', label: 'Last 7 days' },
                { value: 'LAST_30_DAYS', label: 'Last 30 days' },
                { value: 'LAST_3_MONTHS', label: 'Last 3 months' },
                { value: 'LAST_6_MONTHS', label: 'Last 6 months' },
                { value: 'YEAR_TO_DATE', label: 'Year to date' },
                { value: 'CUSTOM', label: 'Custom' },
              ]}
              onChange={(preset) => {
                setDatePreset(preset);
                if (preset !== 'CUSTOM') {
                  setDraft((current) => ({ ...current, timePeriod: periodForPreset(preset, now) }));
                }
              }}
            />
            <DateField label="Start date" value={draft.timePeriod.start} onChange={setStart} />
            <DateField label="End date" description="Exclusive end date" value={draft.timePeriod.end} onChange={setEnd} />
            <SelectField<CostExplorerReportRequest['mode']>
              label="Report mode"
              value={draft.mode}
              options={[
                { value: 'STANDARD', label: 'Standard' },
                { value: 'RESOURCE', label: 'Resource', disabled: !granularDataEnabled },
                { value: 'COMPARISON', label: 'Comparison' },
              ]}
              onChange={(mode) => {
                setComparisonPreset('CUSTOM');
                setDraft((current) => ({
                  ...current,
                  mode,
                  ...(mode === 'COMPARISON'
                    ? {
                        comparisonTimePeriod: current.comparisonTimePeriod ?? previousPeriod(current.timePeriod),
                        showForecast: false,
                      }
                    : { comparisonTimePeriod: undefined }),
                  ...(mode !== 'STANDARD' ? { showForecast: false } : {}),
                }));
              }}
            />
          </ColumnLayout>
        </section>

        {draft.mode === 'COMPARISON' && draft.comparisonTimePeriod && (
          <section aria-label="Comparison period">
            <Container variant="stacked">
              <ColumnLayout columns={compact ? 1 : 3}>
                <SelectField<'MONTH_TO_MONTH' | 'CUSTOM'>
                  label="Comparison range"
                  value={comparisonPreset}
                  options={[
                    { value: 'MONTH_TO_MONTH', label: 'Month to month' },
                    { value: 'CUSTOM', label: 'Custom comparison' },
                  ]}
                  onChange={(preset) => {
                    setComparisonPreset(preset);
                    if (preset === 'MONTH_TO_MONTH') {
                      const periods = closedMonthComparison(now);
                      setDatePreset('CUSTOM');
                      setDraft((current) => ({ ...current, ...periods }));
                    }
                  }}
                />
                <DateField
                  label="Comparison start date"
                  value={draft.comparisonTimePeriod.start}
                  onChange={(value) => setComparison('start', value)}
                />
                <DateField
                  label="Comparison end date"
                  value={draft.comparisonTimePeriod.end}
                  onChange={(value) => setComparison('end', value)}
                />
              </ColumnLayout>
            </Container>
          </section>
        )}

        <section aria-label="Cost calculation">
          <ColumnLayout columns={columns}>
            <SelectField
              label="Billing view"
              value={draft.billingViewArn ?? ''}
              options={billingViewOptions}
              onFocus={() => void loadBillingViews()}
              onChange={(value) => setDraft((current) => ({ ...current, billingViewArn: value || undefined }))}
              footer={
                billingViewsLoading ? (
                  <StatusIndicator type="loading">Loading…</StatusIndicator>
                ) : billingViewsError ? (
                  <div role="alert">
                    <StatusIndicator type="error">{billingViewsError}</StatusIndicator>
                  </div>
                ) : undefined
              }
            />
            <SelectField<CostExplorerReportRequest['metric']>
              label="Metric"
              value={draft.metric}
              options={metrics.map(([value, label]) => ({ value, label }))}
              onChange={(metric) => setDraft((current) => ({ ...current, metric }))}
            />
            <SelectField<CostExplorerReportRequest['granularity']>
              label="Granularity"
              value={draft.granularity}
              options={[
                { value: 'MONTHLY', label: 'Monthly' },
                { value: 'DAILY', label: 'Daily' },
                { value: 'HOURLY', label: 'Hourly', disabled: !granularDataEnabled || draft.mode !== 'RESOURCE' },
              ]}
              onChange={(granularity) => setDraft((current) => ({ ...current, granularity }))}
            />
            <SelectField<CostExplorerReportRequest['chartStyle']>
              label="Chart style"
              value={effectiveDraft.chartStyle}
              options={[
                { value: 'BAR', label: 'Bar' },
                { value: 'STACK', label: 'Stacked bar' },
                { value: 'LINE', label: 'Line' },
              ]}
              onChange={(next) => {
                setDraft((current) => ({ ...current, chartStyle: next }));
                onChartStyleChange?.(next);
              }}
            />
          </ColumnLayout>
        </section>

        <section aria-label="Group definitions">
          <ColumnLayout columns={compact ? 1 : 2}>
            <GroupControl index={0} group={draft.groupBy[0] ?? null} onChange={(group) => updateGroup(0, group)} />
            <GroupControl index={1} group={draft.groupBy[1] ?? null} onChange={(group) => updateGroup(1, group)} />
          </ColumnLayout>
        </section>

        <FilterBuilder
          value={draft.filter}
          timePeriod={draft.timePeriod}
          billingViewArn={draft.billingViewArn}
          onChange={(filter) => setDraft((current) => ({ ...current, filter }))}
        />

        <section aria-labelledby="advanced-options-heading">
          <SpaceBetween size="s">
            <Header variant="h3">
              <span id="advanced-options-heading">Advanced options</span>
            </Header>
            <ColumnLayout columns={compact ? 1 : 3}>
              {[
                {
                  label: 'Show forecast',
                  checked: draft.showForecast,
                  disabled: forecastDisabled,
                  update: (checked: boolean) => ({ showForecast: checked }),
                },
                {
                  label: 'Show only untagged',
                  checked: draft.showOnlyUntagged,
                  disabled: false,
                  update: (checked: boolean) => ({ showOnlyUntagged: checked }),
                },
                {
                  label: 'Show only uncategorized',
                  checked: draft.showOnlyUncategorized,
                  disabled: false,
                  update: (checked: boolean) => ({ showOnlyUncategorized: checked }),
                },
              ].map((option) => (
                <Checkbox
                  key={option.label}
                  checked={option.checked}
                  disabled={option.disabled}
                  onChange={({ detail }) => setDraft((current) => ({ ...current, ...option.update(detail.checked) }))}
                >
                  {option.label}
                </Checkbox>
              ))}
            </ColumnLayout>
            {forecastDisabled && !forecastMessageIsValidationIssue && (
              <Box color="text-body-secondary">{forecastMessage}</Box>
            )}
          </SpaceBetween>
        </section>

        <IssueList issues={validation.issues} />

        {savedReports && onSaveReport && onDeleteReport && (
          <SavedReports
            reports={savedReports}
            currentRequest={effectiveDraft}
            loading={reportsLoading}
            error={reportsError}
            onLoad={setLoadedReport}
            onSave={onSaveReport}
            onDelete={onDeleteReport}
            compact={compact}
          />
        )}

        <SpaceBetween direction="horizontal" size="xs">
          <Button iconName="undo" onClick={reset}>
            Reset report
          </Button>
          <Button iconName="copy" onClick={() => void copyLink()}>
            Copy report link
          </Button>
          <Button variant="primary" iconName="caret-right-filled" onClick={apply} disabled={!validation.valid}>
            Apply report
          </Button>
        </SpaceBetween>
        {copyStatus && (
          <div role="status">
            <Box color="text-body-secondary">{copyStatus}</Box>
          </div>
        )}
      </SpaceBetween>
    </Container>
  );
}
