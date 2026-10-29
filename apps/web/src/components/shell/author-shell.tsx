'use client';

import { BookOpen, House, MessagesSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookLeafLogo } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { RealtimeProvider } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { FullPageLoader, NotificationsMenu, RealtimeDot, SessionGate, UserMenu } from './shared';

const NAV = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/books', label: 'Bookshelf', icon: BookOpen },
  { href: '/support', label: 'Support', icon: MessagesSquare },
];

export function AuthorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <SessionGate audience="author" fallback={<FullPageLoader />}>
      {(user) => (
        <RealtimeProvider>
          <div className="flex min-h-dvh flex-col">
            <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
              <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-5">
                <Link
                  href="/home"
                  className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <BookLeafLogo subtitle="Author portal" />
                </Link>
                <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
                  {NAV.map(({ href, label }) => {
                    const active = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'rounded-lg px-3.5 py-2 text-sm font-semibold transition',
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </nav>
                <div className="ml-auto flex items-center gap-1.5">
                  <RealtimeDot className="mr-2" />
                  <Button asChild variant="accent" size="sm" className="hidden sm:inline-flex">
                    <Link href="/support/new">
                      <Plus /> New query
                    </Link>
                  </Button>
                  <NotificationsMenu hrefFor={(n) => (n.ticketId ? `/support/${n.ticketId}` : null)} />
                  <UserMenu user={user} />
                </div>
              </div>
            </header>

            <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-28 pt-10 md:pb-16">{children}</main>

            <footer className="hidden border-t border-border/70 py-6 text-center text-xs text-muted-foreground md:block">
              BookLeaf Publishing · India &amp; US · Questions? Open a query any time, we answer every one.
            </footer>

            {/* Thumb-reachable navigation on phones */}
            <nav
              aria-label="Main"
              className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl border bg-card/95 px-2 py-2 shadow-lift backdrop-blur md:hidden"
            >
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <Icon className={cn('size-5', active && 'text-accent')} />
                    {label}
                  </Link>
                );
              })}
              <Link
                href="/support/new"
                className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold text-muted-foreground"
              >
                <Plus className="size-5" /> Ask
              </Link>
            </nav>
          </div>
        </RealtimeProvider>
      )}
    </SessionGate>
  );
}
