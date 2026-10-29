import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:shrink-0 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_6px_16px_-8px_rgb(0_0_0/0.5)] hover:bg-primary/90',
        accent:
          'bg-accent text-accent-foreground shadow-[0_6px_18px_-8px_var(--accent)] hover:brightness-105',
        leaf: 'bg-leaf text-leaf-foreground shadow-[0_6px_18px_-8px_var(--leaf)] hover:brightness-110',
        outline: 'border border-input bg-card text-foreground hover:bg-muted',
        soft: 'bg-muted text-foreground hover:bg-muted/70',
        ghost: 'text-foreground hover:bg-muted',
        danger: 'bg-danger text-white hover:brightness-110',
        link: 'h-auto px-0 text-foreground underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[13px] [&_svg]:size-3.5',
        md: 'h-10 px-4 text-sm [&_svg]:size-4',
        lg: 'h-12 px-6 text-[15px] [&_svg]:size-[18px]',
        xl: 'h-14 px-8 text-base [&_svg]:size-5',
        icon: 'size-10 [&_svg]:size-[18px]',
        'icon-sm': 'size-8 rounded-lg [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <LoaderCircle className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}
