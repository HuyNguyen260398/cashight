'use client';

import { useMemo, useState } from 'react';
import type { CostExplorerReportRequest } from '@cashight/domain/aws-cost-explorer';
import { CartesianChart } from '@cloudscape-design/chart-components';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import type {
  CostExplorerComparison,
  CostExplorerCompleteResult,
  CostExplorerForecast,
} from '@/frontend/api/contracts';
import { ChartLoading } from '@/app/components/charts/chart-states';
import { costUsageSeries, seriesId, type ChartStyle } from '@/app/components/charts/cost-series';
import { useHighcharts } from '@/app/components/charts/use-highcharts';
import { formatCompactCost, formatCostValue } from './cost-format';

const CHART_HEIGHT = 320;

const CHART_STYLES: ReadonlyArray<{ id: ChartStyle; text: string; iconName: 'view-full' | 'view-vertical' | 'view-horizontal' }> = [
  { id: 'BAR', text: 'Bar', iconName: 'view-vertical' },
  { id: 'STACK', text: 'Stacked bar', iconName: 'view-full' },
  { id: 'LINE', text: 'Line', iconName: 'view-horizontal' },
];

export function CostUsageGraph({
  request,
  result,
  forecast,
  comparison,
  chartStyle,
  onChartStyleChange,
}: {
  request: CostExplorerReportRequest;
  result: CostExplorerCompleteResult | null;
  forecast: CostExplorerForecast | null;
  comparison: CostExplorerComparison | null;
  /** Presentational override; falls back to the request's own style. */
  chartStyle?: ChartStyle;
  /** Omit to render the panel without the style toggle. */
  onChartStyleChange?: (style: ChartStyle) => void;
}) {
  const highcharts = useHighcharts();
  const activeChartStyle = chartStyle ?? request.chartStyle;
  const comparisonMetricName = comparison ? Object.keys(comparison.total)[0] : undefined;
  const comparisonMetric = comparisonMetricName ? comparison?.total[comparisonMetricName] : undefined;
  const unit = result?.currencyOrUnit ?? comparisonMetric?.unit ?? forecast?.unit ?? 'USD';

  const chart = useMemo(
    () => costUsageSeries({ request, result, forecast, comparison, chartStyle: activeChartStyle }),
    [request, result, forecast, comparison, activeChartStyle],
  );

  // Hidden series reset when the report or dataset changes, but survive a
  // presentational chart-style switch.
  const datasetSignature = seriesId(
    JSON.stringify({
      request: {
        mode: request.mode,
        billingViewArn: request.billingViewArn,
        timePeriod: request.timePeriod,
        comparisonTimePeriod: request.comparisonTimePeriod,
        granularity: request.granularity,
        metric: request.metric,
        groupBy: request.groupBy,
        filter: request.filter,
        showForecast: request.showForecast,
        showOnlyUntagged: request.showOnlyUntagged,
        showOnlyUncategorized: request.showOnlyUncategorized,
      },
      series: chart.series.map((s) => [s.id, s.name]),
    }),
  );
  const [legendState, setLegendState] = useState<{ signature: string; hidden: ReadonlySet<string> }>(() => ({
    signature: datasetSignature,
    hidden: new Set(),
  }));
  const hidden = legendState.signature === datasetSignature ? legendState.hidden : new Set<string>();
  const visibleSeries = chart.series.map((s) => s.id!).filter((id) => !hidden.has(id));

  const summary = chart.series
    .map((s, index) => {
      const total =
        comparisonMetric && s.id === 'baseline'
          ? comparisonMetric.baseline
          : comparisonMetric && s.id === 'comparison'
            ? comparisonMetric.comparison
            : s.id === 'forecast'
              ? forecast?.total
              : result?.series[index]?.total;
      return total ? `${s.name}: ${formatCostValue(total, unit)}` : s.name;
    })
    .join('. ');

  const forecastUnavailable = request.showForecast && !forecast;

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={`${request.granularity.toLowerCase()} ${request.metric} trend with exact AWS values.`}
          actions={
            onChartStyleChange ? (
              <SegmentedControl
                label="Chart type"
                selectedId={activeChartStyle}
                options={CHART_STYLES.map(({ id, text, iconName }) => ({ id, text, iconName }))}
                onChange={({ detail }) => onChartStyleChange(detail.selectedId as ChartStyle)}
              />
            ) : undefined
          }
        >
          Cost and usage graph
        </Header>
      }
    >
      {chart.series.length === 0 || chart.categories.length === 0 ? (
        <Box textAlign="center" padding={{ vertical: 'xl' }}>
          <SpaceBetween size="xs">
            <Box color="text-body-secondary">No cost data for this report.</Box>
            {forecastUnavailable ? <StatusIndicator type="warning">Forecast unavailable</StatusIndicator> : null}
          </SpaceBetween>
        </Box>
      ) : !highcharts ? (
        <ChartLoading height={CHART_HEIGHT} />
      ) : (
        <SpaceBetween size="s">
          {/* group, not img: an img role would hide the interactive legend
              from assistive technology. */}
          <div role="group" aria-label={chart.ariaLabel}>
            <CartesianChart
              highcharts={highcharts}
              chartHeight={CHART_HEIGHT}
              ariaLabel={chart.ariaLabel}
              series={chart.series}
              stacking={chart.stacking}
              visibleSeries={visibleSeries}
              onVisibleSeriesChange={({ detail }) => {
                const visible = new Set(detail.visibleSeries);
                setLegendState({
                  signature: datasetSignature,
                  hidden: new Set(chart.series.map((s) => s.id!).filter((id) => !visible.has(id))),
                });
              }}
              xAxis={{ type: 'category', categories: chart.categories }}
              yAxis={{ valueFormatter: (v) => formatCompactCost(v ?? 0, unit) }}
              tooltip={{ point: ({ item }) => ({ key: item.series.name, value: formatCostValue(item.y ?? 0, unit) }) }}
            />
          </div>
          <span className="visually-hidden">{summary}</span>
          {forecastUnavailable ? <StatusIndicator type="warning">Forecast unavailable</StatusIndicator> : null}
        </SpaceBetween>
      )}
    </Container>
  );
}
