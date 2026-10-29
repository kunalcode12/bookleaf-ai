'use client';

import { SALES_PLATFORM_LABELS } from '@bookleaf/contracts';
import {
  ArrowLeft,
  Barcode,
  CalendarClock,
  MessageSquarePlus,
  Printer,
  Tag,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { BookCover, ProductionTracker } from '@/components/book';
import { ErrorState, InlineNotice } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Eyebrow } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { useMyBook, useSession } from '@/lib/api/queries';
import { count, longDate, money } from '@/lib/format';

function Ledger({ rows }: { rows: Array<{ label: string; value: string; strong?: boolean }> }) {
  return (
    <dl className="divide-y divide-dashed">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-3">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className={row.strong ? 'figure text-2xl font-black' : 'figure text-lg font-bold'}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function BookDetail({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const book = useMyBook(bookId);
  const session = useSession();

  if (book.isError) return <ErrorState error={book.error} onRetry={() => void book.refetch()} />;
  if (!book.data) {
    return (
      <div className="grid gap-10 md:grid-cols-[13rem_1fr]">
        <Skeleton className="aspect-[2/3] w-52 rounded-md" />
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-14 w-3/4" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    );
  }

  const b = book.data;
  const published = b.production.isPublished;
  const payoutTone =
    b.payout.status === 'attention' ? 'warning' : b.payout.status === 'settled' ? 'success' : 'info';

  return (
    <div className="space-y-10">
      <title>{`${b.title} · BookLeaf`}</title>
      <Link
        href="/books"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Bookshelf
      </Link>

      <section className="grid gap-10 md:grid-cols-[13rem_1fr] md:items-start">
        <BookCover
          title={b.title}
          author={session.data?.user.displayName}
          stage={b.status}
          size="xl"
          className="mx-auto md:mx-0"
        />
        <div>
          <Eyebrow>{b.genre}</Eyebrow>
          <h1 className="mt-3 font-display text-5xl font-black leading-[0.95] md:text-6xl">{b.title}</h1>
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge tone={published ? 'leaf' : 'accent'} size="lg">
              {b.statusLabel}
            </Badge>
            <Badge tone="neutral" size="lg">
              <Barcode /> ISBN {b.isbn}
            </Badge>
            {b.publicationDate && (
              <Badge tone="neutral" size="lg">
                <CalendarClock /> Published {longDate(b.publicationDate)}
              </Badge>
            )}
            {b.mrp && (
              <Badge tone="neutral" size="lg">
                <Tag /> MRP {money(b.mrp)}
              </Badge>
            )}
            {b.printPartnerLabel && (
              <Badge tone="neutral" size="lg">
                <Printer /> {b.printPartnerLabel}
              </Badge>
            )}
          </div>
          {published && b.availableOn.length > 0 && (
            <p className="mt-5 text-sm text-muted-foreground">
              On sale at{' '}
              <span className="font-semibold text-foreground">
                {b.availableOn.map((l) => SALES_PLATFORM_LABELS[l.platform]).join(' · ')}
              </span>
            </p>
          )}
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={`/support/new?book=${b.id}`}>
                <MessageSquarePlus /> Ask about this book
              </Link>
            </Button>
            {b.openTicketCount > 0 && (
              <Button asChild size="lg" variant="outline">
                <Link href="/support">
                  {b.openTicketCount} open {b.openTicketCount === 1 ? 'query' : 'queries'}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardContent>
            <h2 className="font-display text-2xl font-black">Royalties</h2>
            {published ? (
              <>
                <Ledger
                  rows={[
                    { label: 'Copies sold', value: count(b.copiesSold) },
                    { label: 'Royalty per copy', value: money(b.royaltyPerCopy) },
                    { label: 'Earned to date', value: money(b.royaltyEarned) },
                    { label: 'Paid to you', value: money(b.royaltyPaid) },
                    { label: 'Pending', value: money(b.royaltyPending), strong: true },
                  ]}
                />
                <InlineNotice
                  className="mt-4"
                  tone={payoutTone}
                  icon={b.payout.status === 'attention' ? <TriangleAlert /> : <CalendarClock />}
                  title={
                    b.payout.nextPayoutDate && b.payout.status !== 'settled'
                      ? `Next payout window: by ${longDate(b.payout.nextPayoutDate)}`
                      : b.payout.lastPayoutDate
                        ? `Last payout ${longDate(b.payout.lastPayoutDate)}`
                        : undefined
                  }
                >
                  {b.payout.message}
                </InlineNotice>
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Royalties are calculated every quarter and paid within 45 days of the quarter ending.
                  Balances under ₹1,000 roll over to the next quarter.
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Royalties start the moment your book goes live. You'll see every copy sold, and every rupee
                earned, right here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-display text-2xl font-black">Production</h2>
              <span className="figure text-sm font-bold text-muted-foreground">
                {b.production.stepNumber}/{b.production.totalSteps}
              </span>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed">
              <span className="font-semibold">{b.production.stageLabel}.</span>{' '}
              {b.production.stageDescription}
            </p>
            <div className="mt-6">
              <ProductionTracker production={b.production} />
            </div>
            {b.production.commonDelay && (
              <InlineNotice className="mt-6" tone="info" icon={<CalendarClock />} title="Good to know">
                {b.production.commonDelay}
              </InlineNotice>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
