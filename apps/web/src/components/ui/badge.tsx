import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold leading-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-foreground',
        outline: 'border-input bg-transparent text-muted-foreground',
        ink: 'border-transparent bg-primary text-primary-foreground',
        leaf: 'border-transparent bg-leaf-soft text-leaf-ink',
        accent: 'border-transparent bg-accent-soft text-accent-ink',
        critical: 'border-transparent bg-critical-soft text-critical',
        high: 'border-transparent bg-high-soft text-high',
        medium: 'border-transparent bg-medium-soft text-medium',
        low: 'border-transparent bg-low-soft text-low',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        danger: 'border-transparent bg-danger-soft text-danger',
        info: 'border-transparent bg-info-soft text-info',
      },
      size: {
        sm: 'h-5 px-2 text-[11px]',
        md: 'h-6 px-2.5 text-xs',
        lg: 'h-8 px-3.5 text-sm',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
