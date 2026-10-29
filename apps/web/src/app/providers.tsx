'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Tooltip } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { isApiError } from '@/lib/api/client';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        // Don't hammer the API on errors the user must fix (401/403/404/422…).
        retry: (failures, error) => (isApiError(error) && !error.retryable ? false : failures < 2),
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <NuqsAdapter>
          <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>
            {children}
          </Tooltip.Provider>
        </NuqsAdapter>
        <Toaster
          position="bottom-right"
          closeButton
          toastOptions={{
            classNames: {
              toast:
                'paper !rounded-xl !border-border !bg-card !text-card-foreground !font-sans !shadow-lift',
              title: '!font-semibold',
              description: '!text-muted-foreground',
            },
          }}
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
