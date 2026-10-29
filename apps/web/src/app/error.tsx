'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="font-display text-5xl font-black">A page came loose.</h1>
      <p className="max-w-md text-muted-foreground">
        Something unexpected happened while loading this screen. Your data is safe. Try again, and if it keeps
        happening, open a query and mention the reference below.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <Button onClick={reset} size="lg">
        <RefreshCw /> Try again
      </Button>
    </main>
  );
}
