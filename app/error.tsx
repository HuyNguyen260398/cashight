'use client';

import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';

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
      header="Something went wrong"
      action={<Button onClick={() => reset()}>Try again</Button>}
    >
      {error.message || 'An unexpected error occurred.'}
    </Alert>
  );
}
