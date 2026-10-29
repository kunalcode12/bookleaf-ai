'use client';

import { ChevronRight, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, PageHeader, Skeleton } from '@/components/ui/misc';
import { useAuthors } from '@/lib/api/queries';
import { count, money, shortDate } from '@/lib/format';

export default function AuthorsPage() {
  const authors = useAuthors();
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = authors.data?.data ?? [];
    return q
      ? all.filter((a) => `${a.name} ${a.email} ${a.externalId} ${a.city ?? ''}`.toLowerCase().includes(q))
      : all;
  }, [authors.data, search]);

  return (
    <div className="space-y-8">
      <title>Authors · BookLeaf desk</title>
      <PageHeader
        eyebrow="Authors"
        title="Who we publish"
        description="Every BookLeaf author, their catalogue and royalty position, one click from their conversations."
        actions={
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, ID or city"
              className="h-10 pl-10"
              aria-label="Search authors"
            />
          </div>
        }
      />
      {authors.isError ? (
        <ErrorState error={authors.error} onRetry={() => void authors.refetch()} />
      ) : authors.isPending ? (
        <Skeleton className="h-[30rem] rounded-2xl" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No authors match"
          description="Try another name, email or author ID."
        />
      ) : (
        <div className="paper overflow-hidden rounded-2xl">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_2rem] gap-4 border-b bg-muted/40 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground lg:grid">
            <span>Author</span>
            <span>Books</span>
            <span className="text-right">Copies sold</span>
            <span className="text-right">Pending royalty</span>
            <span className="text-right">Open tickets</span>
            <span />
          </div>
          <ul className="divide-y">
            {list.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/desk/authors/${a.id}`}
                  className="group grid grid-cols-[1fr_auto] items-center gap-4 px-6 py-4 transition hover:bg-muted/50 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_2rem]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={a.name} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{a.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {a.externalId} · {a.city ?? '—'} · since {shortDate(a.joinedDate)}
                      </span>
                    </span>
                  </span>
                  <span className="hidden text-sm lg:block">
                    {a.bookCount} · <span className="text-muted-foreground">{a.liveBooks} live</span>
                  </span>
                  <span className="figure hidden text-right font-bold lg:block">{count(a.copiesSold)}</span>
                  <span className="figure hidden text-right font-bold lg:block">
                    {money(a.royaltyPending)}
                  </span>
                  <span className="hidden text-right lg:block">
                    {a.openTickets > 0 ? (
                      <Badge tone="accent">{a.openTickets} open</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </span>
                  <ChevronRight className="size-4 justify-self-end text-muted-foreground transition group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
