import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';

export function EmptyState() {
  return (
    <Container>
      <Box textAlign="center" padding={{ vertical: 'xl' }}>
        <SpaceBetween size="s" alignItems="center">
          <Box variant="h2">No statements yet</Box>
          <Box color="text-body-secondary">Upload a statement to get started.</Box>
          <Button variant="primary" href="#statement-upload">
            Upload statement
          </Button>
        </SpaceBetween>
      </Box>
    </Container>
  );
}
