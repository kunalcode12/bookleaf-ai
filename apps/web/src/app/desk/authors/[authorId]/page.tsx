'use client';

import { ArrowLeft, Mail, MapPin, Phone } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { BookCover, ProductionTracker } from '@/components/book';
import { StatTile } from '@/components/money-stat';
import { EmptyState, ErrorState } from '@/components/states';
import { PriorityBadge, SlaChip, StatusBadge } from '@/components/ticket-badges';
import { Badge } from '@/components/ui/badge';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { useAuthor } from '@/lib/api/queries';
import { ago, count, money, shortDate } from '@/lib/format';

export default function AuthorDetailPage({ params }: { params: Promise<{ authorId: string }> }) {
  const { authorId } = use(params);
  const author = useAuthor(authorId);

  if (author.isError) return <ErrorState error={author.error} onRetry={() => void author.refetch()} />;
  if (!author.data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-1/2" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  const a = author.data;

  return (
    <div className="space-y-10">
      <title>{`${a.name} · BookLeaf desk`}</title>
      <Link
        href="/desk/authors"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Authors
      </Link>
      <header className="flex flex-col gap-5 md:flex-row md:items-center">
        <Avatar name={a.name} size="lg" className="size-16 text-xl" />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {a.externalId} · author since {shortDate(a.joinedDate)}
          </p>
          <h1 className="mt-1 font-display text-5xl font-black leading-none">{a.name}</h1>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="size-4" /> {a.email}
            </span>
            {a.phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-4" /> {a.phone}
              </span>
            )}
            {a.city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" /> {a.city}
              </span>
            )}
          </p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile tone="ink" label="Pending royalty" value={money(a.royaltyPending)} />
        <StatTile label="Earned to date" value={money(a.royaltyEarned)} />
        <StatTile label="Copies sold" value={count(a.copiesSold)} />
        <StatTile label="Books" value={a.bookCount} sub={`${a.liveBooks} live`} />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-3xl font-black">Catalogue</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {a.books.map((b) => (
            <div key={b.id} className="paper flex gap-5 rounded-2xl p-5">
              <BookCover title={b.title} author={a.name} stage={b.status} />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    {b.externalId} · {b.genre}
                  </p>
                  <h3 className="mt-1 font-display text-xl font-black leading-tight">{b.title}</h3>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">ISBN {b.isbn}</p>
                </div>
                {b.production.isPublished ? (
                  <>
                    <dl className="grid grid-cols-3 gap-2 text-[13px]">
                      <div>
                        <dt className="text-muted-foreground">Sold</dt>
                        <dd className="figure font-bold">{count(b.copiesSold)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Paid</dt>
                        <dd className="figure font-bold">{money(b.royaltyPaid)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Pending</dt>
                        <dd className="figure font-bold">{money(b.royaltyPending)}</dd>
                      </div>
                    </dl>
                    <p className="text-[12px] leading-snug text-muted-foreground">{b.payout.message}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {b.availableOn.map((l) => (
                        <Badge key={l.platform} tone="outline" size="sm">
                          {l.label}
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">{b.statusLabel}</p>
                    <ProductionTracker production={b.production} compact />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-3xl font-black">Conversations</h2>
        {a.tickets.length === 0 ? (
          <EmptyState title="No tickets yet" description={`${a.name} hasn't contacted support.`} />
        ) : (
          <ul className="paper divide-y overflow-hidden rounded-2xl">
            {a.tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/desk/tickets/${t.number}`}
                  className="flex flex-wrap items-center gap-3 px-6 py-4 transition hover:bg-muted/50"
                >
                  <span className="figure w-16 font-black text-muted-foreground">{t.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t.subject}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {t.book?.title ?? 'General / Account'} · {ago(t.createdAt)}
                    </span>
                  </span>
                  <PriorityBadge priority={t.priority} source={t.prioritySource} size="sm" />
                  {t.status === 'open' || t.status === 'in_progress' ? <SlaChip sla={t.sla} /> : null}
                  <StatusBadge status={t.status} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
