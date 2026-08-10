import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';

export function decimalNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCostValue(
  value: string | number,
  unit: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const amount = typeof value === 'number' ? value : decimalNumber(value);
  if (/^[A-Z]{3}$/.test(unit)) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: unit,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        ...options,
      }).format(amount);
    } catch {
      // Unknown AWS units fall through to decimal formatting below.
    }
  }

  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
    ...options,
  }).format(amount);
  return `${formatted} ${unit}`;
}

export function formatCompactCost(value: number, unit: string): string {
  return formatCostValue(value, unit, {
    notation: 'compact',
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

export function formatFreshness(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function formatPeriodLabel(
  start: string,
  granularity: CostExplorerReportRequest['granularity'],
): string {
  const value = new Date(`${start}T00:00:00.000Z`);
  if (granularity === 'MONTHLY') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(value);
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(value);
}

export function displayGroupValues(
  values: string[],
  groups: CostExplorerReportRequest['groupBy'],
): string {
  return values
    .map((value, index) => {
      if (groups[index]?.type === 'DIMENSION' && groups[index]?.key === 'LINKED_ACCOUNT') {
        const digits = value.match(/\d{4,}/)?.[0];
        return `Linked account •••• ${digits?.slice(-4) ?? '••••'}`;
      }
      return value;
    })
    .join(' / ');
}

export function displayGroupedLabel(
  value: string,
  groups: CostExplorerReportRequest['groupBy'],
): string {
  const linkedAccountGroup = groups.some(
    (group) => group.type === 'DIMENSION' && group.key === 'LINKED_ACCOUNT',
  );
  if (!linkedAccountGroup) return value;

  const exactAccount = value.match(/^\d{4,}$/)?.[0];
  if (exactAccount) return `Linked account •••• ${exactAccount.slice(-4)}`;
  return value.replace(/\d{4,}/g, (digits) => `•••• ${digits.slice(-4)}`);
}

export function percentageFromDifference(
  baseline: string,
  difference: string,
): string | null {
  const baselineNumber = decimalNumber(baseline);
  if (baselineNumber === 0) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    signDisplay: 'exceptZero',
    maximumFractionDigits: 1,
  }).format(decimalNumber(difference) / Math.abs(baselineNumber));
}
