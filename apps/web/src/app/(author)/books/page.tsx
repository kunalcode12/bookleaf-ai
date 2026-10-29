'use client';

import type { Book } from '@bookleaf/contracts';
import { BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BookCover } from '@/components/book';
import { EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useMyBooks, useSession } from '@/lib/api/queries';
import { count, money, shortDate } from '@/lib/format';

const PAYOUT_TONE = {
  attention: 'warning',
  scheduled: 'info',
  below_threshold: 'medium',
  settled: 'success',
  no_sales: 'neutral',
  not_applicable: 'neutral',
} as const;

const PAYOUT_LABEL = {
  attention: 'Payout being checked',
  scheduled: 'Payout scheduled',
  below_threshold: 'Below ₹1,000 minimum',
  settled: 'All paid',
  no_sales: 'No sales yet',
  not_applicable: 'Not yet published',
} as const;

function BookCard({ book, author }: { book: Book; author: string }) {
  return (
    <Link
      href={`/books/${book.id}`}
      className="paper group flex gap-5 rounded-2xl p-5 transition hover:-translate-y-0.5 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring outline-none"
    >
      <BookCover
        title={book.title}
        author={author}
        stage={book.status}
        className="transition group-hover:-rotate-2"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {book.genre}
        </p>
        <h2 className="mt-1.5 font-display text-2xl font-black leading-tight">{book.title}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {book.production.isPublished
            ? `Published ${shortDate(book.publicationDate)}`
            : book.production.stageDescription}
        </p>
        <div className="mt-auto pt-4">
          {book.production.isPublished ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="figure text-2xl font-black leading-none">{money(book.royaltyPending)}</p>
                <p className="mt-1 text-xs text-muted-foreground">pending · {count(book.copiesSold)} sold</p>
              </div>
              <Badge tone={PAYOUT_TONE[book.payout.status]} dot>
                {PAYOUT_LABEL[book.payout.status]}
              </Badge>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between text-xs font-semibold">
                <span>{book.statusLabel}</span>
                <span className="text-muted-foreground">
                  Step {book.production.stepNumber} of {book.production.totalSteps}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(book.production.stepNumber / book.production.totalSteps) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Bookshelf() {
  const books = useMyBooks();
  const session = useSession();
  const [filter, setFilter] = useState<'all' | 'live' | 'production'>('all');
  const list = (books.data?.data ?? []).filter((b) =>
    filter === 'all' ? true : filter === 'live' ? b.production.isPublished : !b.production.isPublished,
  );
  const name = session.data?.user.displayName ?? '';

  return (
    <div className="space-y-10">
      <title>Bookshelf · BookLeaf</title>
      <PageHeader
        eyebrow="Bookshelf"
        title="Your books"
        description="Sales, royalties and production progress for every title you've published with BookLeaf."
        actions={
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="live">Live</TabsTrigger>
              <TabsTrigger value="production">In production</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      {books.isError ? (
        <ErrorState error={books.error} onRetry={() => void books.refetch()} />
      ) : books.isPending ? (
        <div className="grid gap-5 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={filter === 'production' ? 'Nothing in production' : 'No books here yet'}
          description={
            filter === 'production'
              ? 'Every one of your books is live. Time for the next one?'
              : 'Books you publish with BookLeaf appear on this shelf.'
          }
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {list.map((book) => (
            <BookCard key={book.id} book={book} author={name} />
          ))}
        </div>
      )}
    </div>
  );
}
