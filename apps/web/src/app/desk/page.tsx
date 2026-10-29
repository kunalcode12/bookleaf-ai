import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/misc';
import { Queue } from './queue';

export default function DeskPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-16 w-72" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-[28rem] rounded-2xl" />
        </div>
      }
    >
      <Queue />
    </Suspense>
  );
}
