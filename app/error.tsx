'use client';

import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import { AlertHeading } from '@/app/components/console/alert-heading';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Alert
      type="error"
      header={<AlertHeading>Something went wrong</AlertHeading>}
      action={<Button onClick={() => reset()}>Try again</Button>}
    >
      {error.message || 'An unexpected error occurred.'}
    </Alert>
  );
}
