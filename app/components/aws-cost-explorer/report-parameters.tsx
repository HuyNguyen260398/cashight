'use client';

import { useMemo, useState } from 'react';
import { Copy, Loader2, Play, RotateCcw } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
}

const selectClassName =
  'h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-theme-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300';

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

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-gray-700 dark:text-gray-300">
      <span>{label}</span>
      {children}
      {hint && <span className="block font-normal text-gray-500">{hint}</span>}
    </label>
  );
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
    <div className="grid gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800 sm:grid-cols-2">
      <Field label={`Group ${index + 1} type`}>
        <select
          aria-label={`Group ${index + 1} type`}
          className={selectClassName}
          value={type}
          onChange={(event) => {
            const nextType = event.target.value;
            if (nextType === 'NONE') onChange(null);
            else {
              onChange({
                type: nextType as GroupDefinition['type'],
                key: nextType === 'DIMENSION' ? 'SERVICE' : '',
              });
            }
          }}
        >
          <option value="NONE">None</option>
          <option value="DIMENSION">Dimension</option>
          <option value="TAG">Tag</option>
          <option value="COST_CATEGORY">Cost category</option>
        </select>
      </Field>
      <Field label={`Group ${index + 1} key`}>
        {group?.type === 'DIMENSION' ? (
          <select
            aria-label={`Group ${index + 1} key`}
            className={selectClassName}
            value={group.key}
            onChange={(event) => onChange({ ...group, key: event.target.value })}
          >
            {COST_FILTER_DIMENSIONS.map((dimension) => (
              <option key={dimension.key} value={dimension.key}>
                {dimension.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            aria-label={`Group ${index + 1} key`}
            disabled={!group}
            value={group?.key ?? ''}
            placeholder={
              group?.type === 'TAG'
                ? 'Tag key'
                : group?.type === 'COST_CATEGORY'
                  ? 'Cost category name'
                  : 'No group'
            }
            onChange={(event) =>
              group && onChange({ ...group, key: event.target.value })
            }
          />
        )}
      </Field>
    </div>
  );
}

function IssueList({ issues }: { issues: CostExplorerValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-1" aria-live="polite">
      {issues.map((issue, index) => (
        <p
          key={`${issue.path}:${issue.code}:${index}`}
          role={issue.severity === 'ERROR' ? 'alert' : 'status'}
          className={
            issue.severity === 'ERROR'
              ? 'text-sm text-error-600 dark:text-error-400'
              : 'text-sm text-warning-700 dark:text-warning-400'
          }
        >
          {issue.message}
        </p>
      ))}
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
    const parsed = CostExplorerReportRequestSchema.safeParse(draft);
    if (!parsed.success || !validation.valid) return;
    writeReportUrl(parsed.data);
    onApply(parsed.data);
  };

  const copyLink = async () => {
    const parsed = CostExplorerReportRequestSchema.safeParse(draft);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Report parameters</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Date and report mode">
          <Field label="Date range">
            <select
              aria-label="Date range"
              className={selectClassName}
              value={datePreset}
              onChange={(event) => {
                const preset = event.target.value as DateRangePreset;
                setDatePreset(preset);
                if (preset !== 'CUSTOM') {
                  setDraft((current) => ({
                    ...current,
                    timePeriod: periodForPreset(preset, now),
                  }));
                }
              }}
            >
              <option value="CURRENT_MONTH">Current month</option>
              <option value="LAST_7_DAYS">Last 7 days</option>
              <option value="LAST_30_DAYS">Last 30 days</option>
              <option value="LAST_3_MONTHS">Last 3 months</option>
              <option value="LAST_6_MONTHS">Last 6 months</option>
              <option value="YEAR_TO_DATE">Year to date</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </Field>
          <Field label="Start date">
            <Input
              type="date"
              aria-label="Start date"
              value={draft.timePeriod.start}
              onChange={(event) => {
                setDatePreset('CUSTOM');
                setDraft((current) => ({
                  ...current,
                  timePeriod: { ...current.timePeriod, start: event.target.value },
                }));
              }}
            />
          </Field>
          <Field label="End date" hint="Exclusive end date">
            <Input
              type="date"
              aria-label="End date"
              value={draft.timePeriod.end}
              onChange={(event) => {
                setDatePreset('CUSTOM');
                setDraft((current) => ({
                  ...current,
                  timePeriod: { ...current.timePeriod, end: event.target.value },
                }));
              }}
            />
          </Field>
          <Field label="Report mode">
            <select
              aria-label="Report mode"
              className={selectClassName}
              value={draft.mode}
              onChange={(event) => {
                const mode = event.target.value as CostExplorerReportRequest['mode'];
                setComparisonPreset('CUSTOM');
                setDraft((current) => ({
                  ...current,
                  mode,
                  ...(mode === 'COMPARISON'
                    ? {
                        comparisonTimePeriod:
                          current.comparisonTimePeriod ?? previousPeriod(current.timePeriod),
                        showForecast: false,
                      }
                    : { comparisonTimePeriod: undefined }),
                  ...(mode !== 'STANDARD' ? { showForecast: false } : {}),
                }));
              }}
            >
              <option value="STANDARD">Standard</option>
              <option value="RESOURCE" disabled={!granularDataEnabled}>
                Resource
              </option>
              <option value="COMPARISON">Comparison</option>
            </select>
          </Field>
        </section>

        {draft.mode === 'COMPARISON' && draft.comparisonTimePeriod && (
          <section className="grid gap-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800 sm:grid-cols-3" aria-label="Comparison period">
            <Field label="Comparison range">
              <select
                aria-label="Comparison range"
                className={selectClassName}
                value={comparisonPreset}
                onChange={(event) => {
                  const preset = event.target.value as typeof comparisonPreset;
                  setComparisonPreset(preset);
                  if (preset === 'MONTH_TO_MONTH') {
                    const periods = closedMonthComparison(now);
                    setDatePreset('CUSTOM');
                    setDraft((current) => ({ ...current, ...periods }));
                  }
                }}
              >
                <option value="MONTH_TO_MONTH">Month to month</option>
                <option value="CUSTOM">Custom comparison</option>
              </select>
            </Field>
            <Field label="Comparison start date">
              <Input
                type="date"
                aria-label="Comparison start date"
                value={draft.comparisonTimePeriod.start}
                onChange={(event) =>
                  {
                    setComparisonPreset('CUSTOM');
                    setDraft((current) => ({
                      ...current,
                      comparisonTimePeriod: {
                        ...current.comparisonTimePeriod!,
                        start: event.target.value,
                      },
                    }));
                  }
                }
              />
            </Field>
            <Field label="Comparison end date">
              <Input
                type="date"
                aria-label="Comparison end date"
                value={draft.comparisonTimePeriod.end}
                onChange={(event) =>
                  {
                    setComparisonPreset('CUSTOM');
                    setDraft((current) => ({
                      ...current,
                      comparisonTimePeriod: {
                        ...current.comparisonTimePeriod!,
                        end: event.target.value,
                      },
                    }));
                  }
                }
              />
            </Field>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Cost calculation">
          <Field label="Billing view">
            <select
              aria-label="Billing view"
              className={selectClassName}
              value={draft.billingViewArn ?? ''}
              onFocus={() => void loadBillingViews()}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  billingViewArn: event.target.value || undefined,
                }))
              }
            >
              <option value="">All billing data</option>
              {draft.billingViewArn &&
                !billingViews.some((view) => view.arn === draft.billingViewArn) && (
                  <option value={draft.billingViewArn}>Current billing view</option>
                )}
              {billingViews.map((view) => (
                <option key={view.arn} value={view.arn}>{view.name}</option>
              ))}
            </select>
            {billingViewsLoading && <span className="flex items-center gap-1 text-gray-500"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> Loading…</span>}
            {billingViewsError && <span role="alert" className="text-error-600">{billingViewsError}</span>}
          </Field>
          <Field label="Metric">
            <select
              aria-label="Metric"
              className={selectClassName}
              value={draft.metric}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  metric: event.target.value as CostExplorerReportRequest['metric'],
                }))
              }
            >
              {metrics.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Granularity">
            <select
              aria-label="Granularity"
              className={selectClassName}
              value={draft.granularity}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  granularity: event.target.value as CostExplorerReportRequest['granularity'],
                }))
              }
            >
              <option value="MONTHLY">Monthly</option>
              <option value="DAILY">Daily</option>
              <option value="HOURLY" disabled={!granularDataEnabled || draft.mode !== 'RESOURCE'}>Hourly</option>
            </select>
          </Field>
          <Field label="Chart style">
            <select
              aria-label="Chart style"
              className={selectClassName}
              value={draft.chartStyle}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  chartStyle: event.target.value as CostExplorerReportRequest['chartStyle'],
                }))
              }
            >
              <option value="BAR">Bar</option>
              <option value="STACK">Stacked bar</option>
              <option value="LINE">Line</option>
            </select>
          </Field>
        </section>

        <section className="grid gap-3 lg:grid-cols-2" aria-label="Group definitions">
          <GroupControl index={0} group={draft.groupBy[0] ?? null} onChange={(group) => updateGroup(0, group)} />
          <GroupControl index={1} group={draft.groupBy[1] ?? null} onChange={(group) => updateGroup(1, group)} />
        </section>

        <FilterBuilder
          value={draft.filter}
          timePeriod={draft.timePeriod}
          billingViewArn={draft.billingViewArn}
          onChange={(filter) =>
            setDraft((current) => ({ ...current, filter }))
          }
        />

        <section className="space-y-3" aria-labelledby="advanced-options-heading">
          <h3 id="advanced-options-heading" className="text-sm font-semibold text-gray-900 dark:text-white/90">
            Advanced options
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
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
            ].map((option) => {
              const id = option.label.toLowerCase().replace(/ /g, '-');
              return (
                <label key={option.label} htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
                  <Checkbox
                    id={id}
                    aria-label={option.label}
                    checked={option.checked}
                    disabled={option.disabled}
                    onCheckedChange={(checked) =>
                      setDraft((current) => ({
                        ...current,
                        ...option.update(checked === true),
                      }))
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          {forecastDisabled && !forecastMessageIsValidationIssue && (
            <p className="text-sm text-gray-500">
              {forecastMessage}
            </p>
          )}
        </section>

        <IssueList issues={validation.issues} />

        {savedReports && onSaveReport && onDeleteReport && (
          <SavedReports
            reports={savedReports}
            currentRequest={draft}
            loading={reportsLoading}
            error={reportsError}
            onLoad={setLoadedReport}
            onSave={onSaveReport}
            onDelete={onDeleteReport}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-800">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={reset}>
              <RotateCcw aria-hidden />
              Reset report
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void copyLink()}>
              <Copy aria-hidden />
              Copy report link
            </Button>
          </div>
          <Button type="button" className="min-h-11" onClick={apply} disabled={!validation.valid}>
            <Play aria-hidden />
            Apply report
          </Button>
        </div>
        {copyStatus && <p role="status" className="text-sm text-gray-500">{copyStatus}</p>}
      </CardContent>
    </Card>
  );
}
