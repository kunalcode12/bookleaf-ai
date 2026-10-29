'use client';

import { BookDashed, RefreshCw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-input px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&_svg]:size-8">
        {icon ?? <BookDashed />}
      </div>
      <h3 className="font-display text-2xl font-extrabold">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

const FRIENDLY: Record<string, string> = {
  NOT_FOUND: "We couldn't find that. It may have been moved, or it isn't yours to see.",
  FORBIDDEN: "You don't have access to this.",
  RATE_LIMITED: "You're going a little fast. Give it a moment and try again.",
};

export function ErrorState({
  error,
  onRetry,
  title = 'Something went wrong',
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const apiError = isApiError(error) ? error : null;
  const offline = apiError?.code === 'NETWORK';
  const message =
    (apiError && FRIENDLY[apiError.code]) ??
    apiError?.message ??
    'An unexpected error occurred. Please try again.';
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center rounded-2xl border border-danger/25 bg-danger-soft/40 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger [&_svg]:size-7">
        {offline ? <WifiOff /> : <BookDashed />}
      </div>
      <h3 className="font-display text-2xl font-extrabold">{offline ? "You're offline" : title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{message}</p>
      {apiError?.requestId && (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">Reference: {apiError.requestId}</p>
      )}
      {onRetry && (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

/** Inline banner for non-blocking problems inside a page section. */
export function InlineNotice({
  tone = 'info',
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'leaf' | 'success';
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-info/25 bg-info-soft/60 text-info',
    warning: 'border-warning/30 bg-warning-soft/70 text-warning',
    danger: 'border-danger/30 bg-danger-soft/70 text-danger',
    leaf: 'border-leaf/25 bg-leaf-soft/70 text-leaf-ink',
    success: 'border-success/25 bg-success-soft/70 text-success',
  };
  return (
    <div
      className={cn(
        'flex flex-wrap gap-x-3 gap-y-2.5 rounded-xl border px-4 py-3 sm:flex-nowrap',
        tones[tone],
        className,
      )}
    >
      {icon && <div className="mt-0.5 shrink-0 [&_svg]:size-[18px]">{icon}</div>}
      <div className="min-w-0 flex-1 basis-48 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="mt-0.5 leading-relaxed text-foreground/80">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center max-sm:pl-[30px]">{action}</div>}
    </div>
  );
}
