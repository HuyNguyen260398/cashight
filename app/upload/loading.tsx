import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <main className="container mx-auto p-6 max-w-4xl">
      <Skeleton className="h-8 w-56 mb-6" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </main>
  );
}
