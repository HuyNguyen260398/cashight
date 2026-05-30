import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function EmptyState() {
  return (
    <div className="text-center py-16">
      <h2 className="text-xl mb-2">No statements yet</h2>
      <p className="text-muted-foreground mb-6">
        Upload a statement to get started.
      </p>
      <Button asChild>
        <Link href="/upload">Upload statement</Link>
      </Button>
    </div>
  );
}
