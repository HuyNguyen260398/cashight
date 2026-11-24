import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

export const CHART_HEIGHT = 280;

export function ChartLoading({ height = CHART_HEIGHT }: { height?: number }) {
  return (
    <div style={{ minHeight: height, display: 'grid', placeItems: 'center' }}>
      <StatusIndicator type="loading">Loading chart</StatusIndicator>
    </div>
  );
}

export function ChartEmpty({ height = CHART_HEIGHT, children = 'No spending in this period' }: { height?: number; children?: string }) {
  return (
    <div style={{ minHeight: height, display: 'grid', placeItems: 'center' }}>
      <Box color="text-status-inactive" textAlign="center">
        {children}
      </Box>
    </div>
  );
}
