'use client';

import type { AdminTicketListResponse, SessionUser } from '@bookleaf/contracts';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { ChartColumn, Inbox, LibraryBig, Search, Siren, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type ReactNode, useDeferredValue, useEffect, useState } from 'react';
import { BookLeafLogo, LeafGlyph } from '@/components/brand';
import { PriorityBadge, StatusBadge } from '@/components/ticket-badges';
import { Kbd } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/primitives';
import { api, qs } from '@/lib/api/client';
import { useAiHealth, useAlerts, useQueueStats } from '@/lib/api/queries';
import { RealtimeProvider } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { FullPageLoader, NotificationsMenu, RealtimeDot, SessionGate, UserMenu } from './shared';

const NAV = [
  { href: '/desk', label: 'Queue', icon: Inbox, exact: true },
  { href: '/desk/authors', label: 'Authors', icon: Users },
  { href: '/desk/knowledge', label: 'Knowledge base', icon: LibraryBig },
  { href: '/desk/insights', label: 'Insights', icon: ChartColumn },
];

function LeafStatus() {
  const health = useAiHealth();
  const status = health.data?.status;
  const tone =
    status === 'operational'
      ? 'bg-leaf'
      : status === 'degraded'
        ? 'bg-warning'
        : status === 'offline'
          ? 'bg-danger'
          : 'bg-muted-foreground/40';
  const label =
    status === 'operational'
      ? 'Leaf is ready'
      : status === 'degraded'
        ? 'Leaf is degraded'
        : status === 'offline'
          ? 'Leaf is offline'
          : 'Checking Leaf…';
  return (
    <Tooltip content={health.data?.message ?? 'Checking AI providers'} side="right">
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-leaf text-leaf-foreground">
          <LeafGlyph className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-[#f1e9da]">{label}</span>
          <span className="block truncate text-[11px] text-[#a69c8b]">
            {status === 'operational'
              ? 'Triage & drafts live'
              : status
                ? 'Fallbacks keep the desk running'
                : '—'}
          </span>
        </span>
        <span className={cn('size-2 rounded-full', tone)} />
      </div>
    </Tooltip>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const results = useQuery({
    queryKey: ['admin', 'tickets', 'palette', deferred],
    queryFn: ({ signal }) =>
      api.get<AdminTicketListResponse>(`/admin/tickets${qs({ q: deferred, limit: 8, sort: 'urgency' })}`, {
        signal,
      }),
    enabled: open && deferred.length >= 2,
  });

  const go = (href: string) => {
    onOpenChange(false);
    setSearch('');
    router.push(href);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="paper fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Jump to a ticket</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search tickets by BL number, subject or author
          </DialogPrimitive.Description>
          <Command shouldFilter={false} label="Search the desk">
            <div className="flex items-center gap-3 border-b px-4">
              <Search className="size-5 text-muted-foreground" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="BL-1042, an author, a book, a phrase…"
                className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[22rem] overflow-y-auto p-2 scrollbar-thin">
              <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
                {deferred.length < 2
                  ? 'Type at least two characters.'
                  : results.isFetching
                    ? 'Searching…'
                    : 'No tickets match.'}
              </Command.Empty>
              {(results.data?.data.length ?? 0) > 0 && (
                <Command.Group
                  heading="Tickets"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {results.data?.data.map((t) => (
                    <Command.Item
                      key={t.id}
                      value={t.id}
                      onSelect={() => go(`/desk/tickets/${t.number}`)}
                      className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 data-[selected=true]:bg-muted"
                    >
                      <span className="figure w-16 shrink-0 text-sm font-bold text-muted-foreground">
                        {t.number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.subject}</span>
                        <span className="block truncate text-xs text-muted-foreground">{t.author.name}</span>
                      </span>
                      <PriorityBadge priority={t.priority} size="sm" />
                      <StatusBadge status={t.status} size="sm" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group
                heading="Go to"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {NAV.map(({ href, label, icon: Icon }) => (
                  <Command.Item
                    key={href}
                    value={href}
                    onSelect={() => go(href)}
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium data-[selected=true]:bg-muted"
                  >
                    <Icon className="size-4 text-muted-foreground" /> {label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <SessionGate audience="admin" fallback={<FullPageLoader />}>
      {(user) => <AdminFrame user={user}>{children}</AdminFrame>}
    </SessionGate>
  );
}

function AdminFrame({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const stats = useQueueStats();
  const alerts = useAlerts();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openAlerts = alerts.data?.data.filter((a) => a.status === 'open').length ?? 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <RealtimeProvider>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-[17rem] shrink-0 flex-col bg-[#171511] px-4 py-5 text-[#f1e9da] lg:flex dark:bg-[#0c0b09]">
          <Link
            href="/desk"
            className="mb-8 px-2 [&_.fill-primary]:fill-[#f1e9da] [&_.fill-primary-foreground\/90]:fill-[#171511]"
          >
            <BookLeafLogo subtitle="Support desk" className="[&_.text-muted-foreground]:text-[#a69c8b]" />
          </Link>
          <nav className="flex flex-col gap-1" aria-label="Desk">
            {NAV.map(({ href, label, icon: Icon, exact }) => {
              const active = exact
                ? pathname === href || pathname.startsWith('/desk/tickets')
                : pathname.startsWith(href);
              const count = href === '/desk' ? stats.data?.unresolved : undefined;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition',
                    active
                      ? 'bg-[#f1e9da] text-[#171511]'
                      : 'text-[#c9bfae] hover:bg-white/[0.06] hover:text-white',
                  )}
                >
                  <Icon className="size-[18px]" />
                  <span className="flex-1">{label}</span>
                  {count !== undefined && (
                    <span
                      className={cn(
                        'figure rounded-md px-1.5 text-xs font-bold',
                        active ? 'bg-[#171511]/10' : 'bg-white/10',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          {openAlerts > 0 && (
            <Link
              href="/desk#incidents"
              className="mt-6 flex items-center gap-3 rounded-xl border border-[#f27a6e]/30 bg-[#f27a6e]/10 px-3 py-2.5 text-sm font-semibold text-[#f6a59c]"
            >
              <Siren className="size-[18px]" />
              {openAlerts} possible incident{openAlerts === 1 ? '' : 's'}
            </Link>
          )}
          <div className="mt-auto space-y-3">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-[#a69c8b] transition hover:border-white/20 hover:text-[#f1e9da]"
            >
              <Search className="size-4" />
              <span className="flex-1">Jump to ticket…</span>
              <Kbd className="border-white/15 bg-white/5 text-[#a69c8b]">Ctrl K</Kbd>
            </button>
            <LeafStatus />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border/70 bg-background/80 px-5 backdrop-blur-xl lg:px-8">
            <Link href="/desk" className="lg:hidden">
              <BookLeafLogo />
            </Link>
            <nav className="ml-2 flex items-center gap-1 overflow-x-auto lg:hidden" aria-label="Desk">
              {NAV.map(({ href, label, exact }) => {
                const active = exact ? pathname === href : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-semibold',
                      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="ml-auto hidden h-10 w-80 items-center gap-2 whitespace-nowrap rounded-xl border bg-card px-3 text-left text-sm text-muted-foreground transition hover:border-input md:flex lg:ml-0"
            >
              <Search className="size-4 shrink-0" />
              <span className="flex-1 truncate">Search tickets, authors, books…</span>
              <Kbd>Ctrl K</Kbd>
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <RealtimeDot className="mr-2" />
              <NotificationsMenu hrefFor={(n) => (n.ticketId ? `/desk/tickets/${n.ticketId}` : null)} />
              <UserMenu user={user} />
            </div>
          </header>
          <main className="flex-1 px-5 py-8 lg:px-8 lg:py-10">{children}</main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </RealtimeProvider>
  );
}
