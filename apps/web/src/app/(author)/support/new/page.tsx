import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/misc';
import { NewQuery } from './new-query';

export default function NewQueryPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-14 w-2/3" />
          <Skeleton className="h-[32rem] rounded-2xl" />
        </div>
      }
    >
      <NewQuery />
    </Suspense>
  );
}
