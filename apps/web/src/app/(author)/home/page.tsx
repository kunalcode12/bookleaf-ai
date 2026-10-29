'use client';

import type { AuthorTicketSummary } from '@bookleaf/contracts';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  ChevronRight,
  IndianRupee,
  MessagesSquare,
  Plus,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { BookCover } from '@/components/book';
import { LeafGlyph } from '@/components/brand';
import { StatTile } from '@/components/money-stat';
import { EmptyState, ErrorState, InlineNotice } from '@/components/states';
import { StatusBadge } from '@/components/ticket-badges';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { useMyBooks, useMyTickets, useSession } from '@/lib/api/queries';
import { ago, count, greeting, longDate, money } from '@/lib/format';
import { firstName } from '@/lib/utils';

function AskLeafTeaser() {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = question.trim();
    router.push(q ? `/support/new?ask=${encodeURIComponent(q)}` : '/support/new');
  };
  return (
    <form
      onSubmit={submit}
      className="relative overflow-hidden rounded-2xl bg-leaf p-6 text-leaf-foreground shadow-lift sm:p-8"
    >
      <LeafGlyph className="pointer-events-none absolute -right-6 -top-8 size-44 opacity-[0.12]" />
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] opacity-80">
        <LeafGlyph className="size-3.5" /> Ask Leaf
      </p>
      <h2 className="mt-3 max-w-lg font-display text-3xl font-black leading-tight sm:text-4xl">
        Got a question? Leaf answers from BookLeaf policy, instantly.
      </h2>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="When is my next royalty payout?"
          className="h-12 w-full min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 text-[15px] text-leaf-foreground outline-none placeholder:text-leaf-foreground/60 focus:border-white/50 focus:bg-white/15 sm:flex-1"
          aria-label="Your question for Leaf"
        />
        <Button type="submit" size="lg" className="bg-leaf-foreground text-leaf hover:bg-leaf-foreground/90">
          Ask <ArrowRight />
        </Button>
      </div>
      <p className="mt-3 text-xs opacity-75">
        If Leaf can't settle it, it hands your question to the BookLeaf team with the details filled in.
      </p>
    </form>
  );
}

function RecentTicket({ ticket }: { ticket: AuthorTicketSummary }) {
  return (
    <Link
      href={`/support/${ticket.id}`}
      className="group flex items-center gap-4 rounded-xl px-4 py-3.5 transition hover:bg-muted/70"
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
        <MessagesSquare className="size-[18px] text-muted-foreground" />
        {ticket.hasUnreadReply && (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-accent ring-2 ring-card" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{ticket.subject}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {ticket.number} · {ticket.book?.title ?? 'Account'} · {ago(ticket.lastActivityAt)}
        </span>
      </span>
      {ticket.hasUnreadReply ? (
        <span className="hidden rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-accent-foreground sm:inline">
          New reply
        </span>
      ) : (
        <StatusBadge status={ticket.status} size="sm" />
      )}
      <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function AuthorHome() {
  const session = useSession();
  const books = useMyBooks();
  const tickets = useMyTickets('all');
  const name = session.data?.user.displayName ?? '';
  const summary = books.data?.summary;
  const recent = tickets.data?.pages.flatMap((p) => p.data).slice(0, 4) ?? [];
  const attentionBook = books.data?.data.find((b) => b.payout.status === 'attention');

  return (
    <div className="space-y-12">
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <Eyebrow>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Eyebrow>
          <h1 className="mt-3 font-display text-5xl font-black leading-[0.95] md:text-6xl">
            {greeting()}, {name ? firstName(name) : '…'}.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Here's how your books are doing, and where every conversation with BookLeaf stands.
          </p>
        </div>
        <Button asChild size="lg" variant="accent">
          <Link href="/support/new">
            <Plus /> Ask a question
          </Link>
        </Button>
      </header>

      {books.isError ? (
        <ErrorState error={books.error} onRetry={() => void books.refetch()} />
      ) : (
        <section aria-label="Royalties" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {!summary ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[9.5rem] rounded-2xl" />)
          ) : (
            <>
              <StatTile
                tone="ink"
                label="Royalty pending"
                icon={<Wallet />}
                value={money(summary.royaltyPending)}
                sub={
                  summary.nextPayoutDate
                    ? `Next payout window closes ${longDate(summary.nextPayoutDate)}`
                    : 'Royalties start once a book is live'
                }
              />
              <StatTile
                label="Earned to date"
                icon={<IndianRupee />}
                value={money(summary.royaltyEarned)}
                sub={`${count(summary.copiesSold)} copies sold`}
              />
              <StatTile
                label="Paid to you"
                icon={<CalendarClock />}
                value={money(summary.royaltyPaid)}
                sub={
                  summary.lastPayoutDate
                    ? `Last payout ${longDate(summary.lastPayoutDate)}`
                    : 'No payouts yet'
                }
              />
              <StatTile
                label="Your books"
                icon={<BookOpen />}
                value={summary.totalBooks}
                sub={`${summary.liveBooks} live${summary.inProductionBooks ? ` · ${summary.inProductionBooks} in production` : ''}`}
              />
            </>
          )}
        </section>
      )}

      {attentionBook && (
        <InlineNotice
          tone="warning"
          icon={<CalendarClock />}
          title={`We're keeping an eye on "${attentionBook.title}"`}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`/support/new?book=${attentionBook.id}&topic=royalty`}>Ask about it</Link>
            </Button>
          }
        >
          {attentionBook.payout.message}
        </InlineNotice>
      )}

      <section aria-labelledby="shelf-title">
        <div className="mb-5 flex items-end justify-between">
          <h2 id="shelf-title" className="font-display text-3xl font-black">
            Your shelf
          </h2>
          <Link href="/books" className="text-sm font-semibold text-muted-foreground hover:text-foreground">
            See all books →
          </Link>
        </div>
        <div className="paper flex gap-8 overflow-x-auto rounded-2xl px-6 pb-6 pt-7 scrollbar-thin">
          {books.isPending
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[2/3] w-28 shrink-0 rounded-md" />)
            : books.data?.data.map((book) => (
                <Link key={book.id} href={`/books/${book.id}`} className="group w-28 shrink-0 outline-none">
                  <BookCover
                    title={book.title}
                    author={name}
                    stage={book.status}
                    className="transition group-hover:-translate-y-1.5 group-hover:rotate-[-1.5deg] group-focus-visible:ring-2 group-focus-visible:ring-ring"
                  />
                  <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug">{book.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {book.production.isPublished ? `${count(book.copiesSold)} sold` : book.statusLabel}
                  </p>
                </Link>
              ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <section aria-labelledby="recent-title" className="paper rounded-2xl p-2">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <h2 id="recent-title" className="font-display text-2xl font-black">
              Recent conversations
            </h2>
            <Link
              href="/support"
              className="text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              All →
            </Link>
          </div>
          {tickets.isPending ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              className="m-3 border-none bg-muted/40"
              icon={<MessagesSquare />}
              title="No conversations yet"
              description="When you ask BookLeaf something, the whole thread lives here."
            />
          ) : (
            <div className="divide-y divide-border/70">
              {recent.map((t) => (
                <RecentTicket key={t.id} ticket={t} />
              ))}
            </div>
          )}
        </section>
        <AskLeafTeaser />
      </div>
    </div>
  );
}
