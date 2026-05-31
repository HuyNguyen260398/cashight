'use client';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container mx-auto max-w-2xl py-16 text-center">
      <h2 className="text-xl mb-2">Something went wrong</h2>
      <p className="text-muted-foreground mb-6">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
