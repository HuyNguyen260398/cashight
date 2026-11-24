import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

// Root loading.tsx: the global Suspense fallback for every route that doesn't
// define a closer loading.tsx. Shown automatically during route navigation
// while the destination segment streams in.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading page" aria-live="polite">
      <Box textAlign="center" padding={{ vertical: 'xxxl' }}>
        <StatusIndicator type="loading">Loading…</StatusIndicator>
      </Box>
    </div>
  );
}
