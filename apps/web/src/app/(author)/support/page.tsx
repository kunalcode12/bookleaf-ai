'use client';

import { type AuthorTicketSummary, TICKET_CATEGORY_LABELS } from '@bookleaf/contracts';
import { ChevronRight, MessagesSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/states';
import { StatusBadge } from '@/components/ticket-badges';
import { Button } from '@/components/ui/button';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useMyTickets } from '@/lib/api/queries';
import { ago, stamp } from '@/lib/format';
import { cn } from '@/lib/utils';

function TicketRow({ ticket }: { ticket: AuthorTicketSummary }) {
  return (
    <li>
      <Link
        href={`/support/${ticket.id}`}
        className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-5 transition hover:bg-muted/50 sm:grid-cols-[6.5rem_1fr_auto_auto] sm:px-6"
      >
        <span className="figure hidden text-sm font-bold text-muted-foreground sm:block">
          {ticket.number}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            {ticket.hasUnreadReply && (
              <span className="size-2.5 shrink-0 rounded-full bg-accent">
                <span className="sr-only">New reply</span>
              </span>
            )}
            <span className={cn('truncate text-[17px] font-semibold', ticket.hasUnreadReply && 'font-bold')}>
              {ticket.subject}
            </span>
          </span>
          <span className="mt-1 block truncate text-[13px] text-muted-foreground">
            <span className="sm:hidden">{ticket.number} · </span>
            {ticket.book?.title ?? 'General / Account'}
            {ticket.category && ` · ${TICKET_CATEGORY_LABELS[ticket.category]}`} · updated{' '}
            {ago(ticket.lastActivityAt)}
          </span>
        </span>
        <span className="hidden text-right text-[13px] text-muted-foreground md:block">
          {ticket.hasUnreadReply ? (
            <span className="font-semibold text-accent-ink">New reply from BookLeaf</span>
          ) : ticket.status === 'open' && ticket.expectedResponse ? (
            <>Reply expected {ticket.expectedResponse}</>
          ) : (
            stamp(ticket.createdAt)
          )}
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge status={ticket.status} />
          <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
        </span>
      </Link>
    </li>
  );
}

export default function SupportList() {
  const [tab, setTab] = useState<'active' | 'resolved' | 'all'>('active');
  const tickets = useMyTickets(tab);
  const rows = tickets.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-10">
      <title>Support · BookLeaf</title>
      <PageHeader
        eyebrow="Support"
        title="Your conversations"
        description="Every question you've asked BookLeaf, with the full thread. Replies appear here the moment they're sent."
        actions={
          <Button asChild size="lg" variant="accent">
            <Link href="/support/new">
              <Plus /> New query
            </Link>
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      {tickets.isError ? (
        <ErrorState error={tickets.error} onRetry={() => void tickets.refetch()} />
      ) : tickets.isPending ? (
        <div className="paper divide-y rounded-2xl">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-5">
              <Skeleton className="h-4 w-16" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3.5 w-1/3" />
              </div>
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title={
            tab === 'active'
              ? 'Nothing open right now'
              : tab === 'resolved'
                ? 'No resolved queries yet'
                : 'No conversations yet'
          }
          description="Royalties, ISBNs, printing, distribution, production: ask us anything about your books."
          action={
            <Button asChild variant="accent">
              <Link href="/support/new">
                <Plus /> Ask a question
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="paper overflow-hidden rounded-2xl">
          <ul className="divide-y">
            {rows.map((t) => (
              <TicketRow key={t.id} ticket={t} />
            ))}
          </ul>
          {tickets.hasNextPage && (
            <div className="border-t p-4 text-center">
              <Button
                variant="ghost"
                loading={tickets.isFetchingNextPage}
                onClick={() => void tickets.fetchNextPage()}
              >
                Load older conversations
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
