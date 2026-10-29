'use client';

import {
  ADMIN_TICKET_SORTS,
  type AdminTicketListItem,
  AI_FLAGS,
  type IncidentAlert,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
} from '@bookleaf/contracts';
import {
  CalendarClock,
  Flame,
  Funnel,
  Inbox,
  MessageSquareReply,
  Paperclip,
  Search,
  ShieldAlert,
  Siren,
  TriangleAlert,
  UserRound,
  UserX,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LeafGlyph } from '@/components/brand';
import { EmptyState, ErrorState } from '@/components/states';
import { CategoryIcon, PRIORITY_BAR, PriorityBadge, SlaChip, StatusBadge } from '@/components/ticket-badges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, Kbd, Skeleton } from '@/components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger, Select, Tooltip } from '@/components/ui/primitives';
import {
  type QueueFilters,
  useAlerts,
  useQueue,
  useQueueStats,
  useSession,
  useUpdateAlert,
} from '@/lib/api/queries';
import { compactAge } from '@/lib/format';
import { cn } from '@/lib/utils';

const filterParsers = {
  status: parseAsArrayOf(parseAsStringLiteral(TICKET_STATUSES)).withDefault(['open', 'in_progress']),
  category: parseAsArrayOf(parseAsStringLiteral(TICKET_CATEGORIES)).withDefault([]),
  priority: parseAsArrayOf(parseAsStringLiteral(TICKET_PRIORITIES)).withDefault([]),
  assignee: parseAsString,
  q: parseAsString.withDefault(''),
  sort: parseAsStringLiteral(ADMIN_TICKET_SORTS).withDefault('urgency'),
  flag: parseAsStringLiteral(AI_FLAGS),
  sla: parseAsStringLiteral(['breached', 'at_risk'] as const),
  from: parseAsString,
  to: parseAsString,
};

const SORT_LABELS = {
  urgency: 'Most urgent',
  newest: 'Newest',
  oldest: 'Oldest',
  updated: 'Recently updated',
  priority: 'Priority',
};

function StatButton({
  label,
  value,
  active,
  onClick,
  tone = 'default',
  icon,
}: {
  label: string;
  value: number | undefined;
  active: boolean;
  onClick: () => void;
  tone?: 'default' | 'critical' | 'warning' | 'danger' | 'leaf';
  icon?: React.ReactNode;
}) {
  const tones = {
    default: '',
    critical: 'text-critical',
    warning: 'text-warning',
    danger: 'text-danger',
    leaf: 'text-leaf-ink',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group flex min-w-0 flex-col items-start rounded-2xl px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-lift',
        active ? 'bg-primary text-primary-foreground shadow-lift' : 'paper',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em]',
          active ? 'opacity-80' : 'text-muted-foreground',
        )}
      >
        {icon}
        {label}
      </span>
      {value === undefined ? (
        <Skeleton className="mt-2 h-8 w-10" />
      ) : (
        <span
          className={cn(
            'figure mt-1.5 text-[2rem] font-black leading-none',
            !active && value > 0 && tones[tone],
          )}
        >
          {value}
        </span>
      )}
    </button>
  );
}

function AlertsStrip({ alerts }: { alerts: IncidentAlert[] }) {
  const update = useUpdateAlert();
  const open = alerts.filter((a) => a.status !== 'resolved');
  if (open.length === 0) return null;
  return (
    <section id="incidents" aria-label="Possible incidents" className="space-y-3">
      {open.map((alert) => (
        <div
          key={alert.id}
          className={cn(
            'flex flex-col gap-4 rounded-2xl border p-5 md:flex-row md:items-center',
            alert.status === 'open' ? 'border-danger/30 bg-danger-soft/50' : 'border-border bg-muted/40',
          )}
        >
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-danger text-white">
            <Siren className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-display text-xl font-black">
              {alert.title}
              <span className="rounded-full bg-leaf-soft px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-leaf-ink">
                <LeafGlyph className="mr-1 inline size-3" />
                spotted by Leaf
              </span>
            </p>
            <p className="mt-1 text-[13px] text-foreground/75">{alert.summary}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {alert.tickets.map((t) => (
                <Link
                  key={t.id}
                  href={`/desk/tickets/${t.number}`}
                  className="rounded-md bg-card px-2 py-1 text-xs font-semibold shadow-sm ring-1 ring-border transition hover:ring-input"
                  title={t.subject}
                >
                  {t.number}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {alert.status === 'open' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => update.mutate({ id: alert.id, status: 'acknowledged' })}
              >
                Acknowledge
              </Button>
            )}
            <Button
              size="sm"
              variant="soft"
              onClick={() =>
                update.mutate(
                  { id: alert.id, status: 'resolved' },
                  { onSuccess: () => toast.success('Incident resolved') },
                )
              }
            >
              Resolve
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function QueueRow({
  ticket,
  selected,
  meId,
}: {
  ticket: AdminTicketListItem;
  selected: boolean;
  meId?: string;
}) {
  const injection = ticket.aiFlags.includes('possible_injection');
  const needsReview = ticket.aiFlags.includes('needs_review') || ticket.aiFlags.includes('rule_based');
  return (
    <li>
      <Link
        href={`/desk/tickets/${ticket.number}`}
        data-selected={selected || undefined}
        className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-4 pl-6 pr-5 outline-none transition hover:bg-muted/50 data-[selected]:bg-accent-soft/40 lg:grid-cols-[5.5rem_minmax(0,1fr)_13rem_8.5rem_7.5rem_2rem]"
      >
        <span
          className={cn(
            'absolute inset-y-2 left-0 w-1.5 rounded-r-full',
            ticket.priority ? PRIORITY_BAR[ticket.priority] : 'bg-muted',
          )}
        />
        <span className="hidden flex-col lg:flex">
          <span className="figure text-sm font-black">{ticket.number}</span>
          <span className="text-[12px] text-muted-foreground">{compactAge(ticket.createdAt)} old</span>
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            {ticket.awaitingReply &&
              ticket.status !== 'resolved' &&
              ticket.status !== 'closed' &&
              ticket.messageCount > 0 && (
                <Tooltip content="The author replied and is waiting">
                  <MessageSquareReply className="size-4 shrink-0 text-accent" />
                </Tooltip>
              )}
            <span className="truncate text-[15px] font-bold">{ticket.subject}</span>
            {injection && (
              <Tooltip content="Contains text aimed at an AI (ignored by Leaf)">
                <ShieldAlert className="size-4 shrink-0 text-danger" />
              </Tooltip>
            )}
            {ticket.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground/80">{ticket.author.name}</span>
            {ticket.book && ` · ${ticket.book.title}`}
            {ticket.aiSummary && <span className="hidden xl:inline"> · {ticket.aiSummary}</span>}
          </span>
        </span>
        <span className="hidden min-w-0 items-center gap-1.5 text-[13px] font-semibold lg:flex">
          {ticket.category ? (
            <>
              <CategoryIcon category={ticket.category} className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{TICKET_CATEGORY_LABELS[ticket.category]}</span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-leaf-ink">
              <LeafGlyph className="size-3.5 animate-pulse" /> Triaging…
            </span>
          )}
        </span>
        <span className="flex flex-col items-end gap-1.5 lg:items-start">
          <span className="flex items-center gap-1.5">
            <PriorityBadge priority={ticket.priority} source={ticket.prioritySource} size="sm" />
            {needsReview && !injection && (
              <Tooltip content="Leaf flagged this for a human check">
                <TriangleAlert className="size-3.5 text-warning" />
              </Tooltip>
            )}
          </span>
          <span className="lg:hidden">
            <StatusBadge status={ticket.status} size="sm" />
          </span>
        </span>
        <span className="hidden flex-col items-start gap-1.5 lg:flex">
          {ticket.status === 'open' || ticket.status === 'in_progress' ? (
            <SlaChip sla={ticket.sla} />
          ) : (
            <StatusBadge status={ticket.status} size="sm" />
          )}
          {ticket.status === 'in_progress' && (
            <span className="text-[11px] font-semibold text-info">In progress</span>
          )}
        </span>
        <span className="hidden justify-end lg:flex">
          {ticket.assignee ? (
            <Tooltip content={ticket.assignee.id === meId ? 'Assigned to you' : ticket.assignee.displayName}>
              <span>
                <Avatar
                  name={ticket.assignee.displayName}
                  size="sm"
                  className={cn(ticket.assignee.id === meId && 'ring-accent')}
                />
              </span>
            </Tooltip>
          ) : (
            <Tooltip content="Unassigned">
              <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-input">
                <UserRound className="size-3 text-muted-foreground" />
              </span>
            </Tooltip>
          )}
        </span>
      </Link>
    </li>
  );
}

function MultiChips<T extends string>({
  values,
  selected,
  labels,
  onChange,
}: {
  values: readonly T[];
  selected: T[];
  labels: Record<T, string>;
  onChange: (next: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => {
        const on = selected.includes(value);
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((v) => v !== value) : [...selected, value])}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition',
              on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-input',
            )}
          >
            {labels[value]}
          </button>
        );
      })}
    </div>
  );
}

export function Queue() {
  const router = useRouter();
  const session = useSession();
  const stats = useQueueStats();
  const alerts = useAlerts();
  const [params, setParams] = useQueryStates(filterParsers, { history: 'replace' });
  const [search, setSearch] = useState(params.q);
  const [selected, setSelected] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounced search → URL.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== params.q) void setParams({ q: search || null });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, params.q, setParams]);

  const filters: QueueFilters = useMemo(
    () => ({
      status: params.status,
      category: params.category,
      priority: params.priority,
      assignee: params.assignee,
      q: params.q,
      sort: params.sort,
      flag: params.flag,
      sla: params.sla,
      createdFrom: params.from,
      createdTo: params.to,
    }),
    [params],
  );
  const queue = useQueue(filters);
  const rows = useMemo(() => queue.data?.pages.flatMap((p) => p.data) ?? [], [queue.data]);

  // j/k to move, Enter to open, / to search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable], [role="dialog"]')) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === 'j') {
        setSelected((s) => Math.min(rows.length - 1, s + 1));
      } else if (event.key === 'k') {
        setSelected((s) => Math.max(0, s - 1));
      } else if (event.key === 'Enter' && rows[selected]) {
        router.push(`/desk/tickets/${rows[selected].number}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selected, router]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the keyboard selection moves
  useEffect(() => {
    document.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const isUnresolvedOnly =
    params.status.length === 2 && params.status.includes('open') && params.status.includes('in_progress');
  const quick = {
    reset: () =>
      setParams({
        status: null,
        priority: null,
        assignee: null,
        flag: null,
        sla: null,
        category: null,
        from: null,
        to: null,
      }),
  };
  const toggle = (patch: Parameters<typeof setParams>[0], active: boolean) =>
    void setParams(active ? Object.fromEntries(Object.keys(patch as object).map((k) => [k, null])) : patch);

  const activeFilterCount =
    params.category.length +
    params.priority.length +
    (params.from ? 1 : 0) +
    (params.to ? 1 : 0) +
    (isUnresolvedOnly ? 0 : 1);

  return (
    <div className="space-y-8">
      <title>Queue · BookLeaf desk</title>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="mt-2 font-display text-5xl font-black leading-none md:text-6xl">The Desk</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            {stats.data
              ? `${stats.data.unresolved} unresolved · ${stats.data.resolvedToday} resolved today`
              : 'Loading the queue…'}
          </p>
        </div>
        <div className="hidden items-center gap-3 text-xs text-muted-foreground lg:flex">
          <span className="flex items-center gap-1">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>/</Kbd> search
          </span>
        </div>
      </header>

      {alerts.data && <AlertsStrip alerts={alerts.data.data} />}

      <section aria-label="Queue counters" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatButton
          label="Unresolved"
          value={stats.data?.unresolved}
          active={
            isUnresolvedOnly && !params.priority.length && !params.sla && !params.assignee && !params.flag
          }
          onClick={() => void quick.reset()}
          icon={<Inbox className="size-3.5" />}
        />
        <StatButton
          label="Critical"
          tone="critical"
          value={stats.data?.critical}
          active={params.priority.length === 1 && params.priority[0] === 'critical'}
          onClick={() =>
            toggle(
              { priority: ['critical'] },
              params.priority.length === 1 && params.priority[0] === 'critical',
            )
          }
          icon={<Flame className="size-3.5" />}
        />
        <StatButton
          label="Overdue"
          tone="critical"
          value={stats.data?.breaching}
          active={params.sla === 'breached'}
          onClick={() => toggle({ sla: 'breached' }, params.sla === 'breached')}
          icon={<CalendarClock className="size-3.5" />}
        />
        <StatButton
          label="Due soon"
          tone="warning"
          value={stats.data?.atRisk}
          active={params.sla === 'at_risk'}
          onClick={() => toggle({ sla: 'at_risk' }, params.sla === 'at_risk')}
        />
        <StatButton
          label="Unassigned"
          value={stats.data?.unassigned}
          active={params.assignee === 'unassigned'}
          onClick={() => toggle({ assignee: 'unassigned' }, params.assignee === 'unassigned')}
          icon={<UserX className="size-3.5" />}
        />
        <StatButton
          label="Mine"
          value={stats.data?.mine}
          active={params.assignee === 'me'}
          onClick={() => toggle({ assignee: 'me' }, params.assignee === 'me')}
          icon={<UserRound className="size-3.5" />}
        />
        <StatButton
          label="Needs review"
          tone="warning"
          value={stats.data?.needsReview}
          active={params.flag === 'needs_review'}
          onClick={() => toggle({ flag: 'needs_review' }, params.flag === 'needs_review')}
          icon={<TriangleAlert className="size-3.5" />}
        />
        <StatButton
          label="Manipulation"
          tone="danger"
          value={stats.data?.possibleInjection}
          active={params.flag === 'possible_injection'}
          onClick={() => toggle({ flag: 'possible_injection' }, params.flag === 'possible_injection')}
          icon={<ShieldAlert className="size-3.5" />}
        />
      </section>

      <section className="paper overflow-hidden rounded-2xl" aria-label="Tickets">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, author, book or BL-number…"
              className="h-10 pl-10"
              aria-label="Search tickets"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="md">
                  <Funnel /> Filters
                  {activeFilterCount > 0 && (
                    <span className="figure rounded-md bg-primary px-1.5 text-[11px] text-primary-foreground">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[22rem] space-y-5 p-5">
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Status
                  </p>
                  <MultiChips
                    values={TICKET_STATUSES}
                    selected={params.status}
                    labels={TICKET_STATUS_LABELS}
                    onChange={(status) => void setParams({ status: status.length ? status : null })}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Priority
                  </p>
                  <MultiChips
                    values={TICKET_PRIORITIES}
                    selected={params.priority}
                    labels={TICKET_PRIORITY_LABELS}
                    onChange={(priority) => void setParams({ priority })}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Category
                  </p>
                  <MultiChips
                    values={TICKET_CATEGORIES}
                    selected={params.category}
                    labels={TICKET_CATEGORY_LABELS}
                    onChange={(category) => void setParams({ category })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="filter-from"
                      className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      From
                    </label>
                    <Input
                      id="filter-from"
                      type="date"
                      value={params.from ?? ''}
                      onChange={(e) => void setParams({ from: e.target.value || null })}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="filter-to"
                      className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      To
                    </label>
                    <Input
                      id="filter-to"
                      type="date"
                      value={params.to ?? ''}
                      onChange={(e) => void setParams({ to: e.target.value || null })}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="w-full" onClick={() => void quick.reset()}>
                  <X /> Clear filters
                </Button>
              </PopoverContent>
            </Popover>
            <Select
              aria-label="Sort"
              value={params.sort}
              onValueChange={(sort) => void setParams({ sort })}
              options={ADMIN_TICKET_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
              className="h-10 w-44 text-sm"
            />
          </div>
        </div>

        {queue.isError ? (
          <ErrorState className="m-4" error={queue.error} onRetry={() => void queue.refetch()} />
        ) : queue.isPending ? (
          <ul className="divide-y">
            {Array.from({ length: 7 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
              <li key={i} className="flex items-center gap-4 px-6 py-4">
                <Skeleton className="h-9 w-16" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="hidden h-6 w-28 rounded-full lg:block" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyState
            className="m-5"
            icon={<Inbox />}
            title={params.q ? 'No tickets match that search' : 'Inbox zero'}
            description={
              params.q
                ? 'Try a BL-number, an author name or a book title.'
                : 'Nothing matches these filters. Enjoy the quiet.'
            }
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  void quick.reset();
                  void setParams({ q: null });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <ul className={cn('divide-y transition-opacity', queue.isPlaceholderData && 'opacity-60')}>
              {rows.map((ticket, index) => (
                <QueueRow
                  key={ticket.id}
                  ticket={ticket}
                  selected={index === selected}
                  meId={session.data?.user.id}
                />
              ))}
            </ul>
            {queue.hasNextPage && (
              <div className="border-t p-4 text-center">
                <Button
                  variant="ghost"
                  loading={queue.isFetchingNextPage}
                  onClick={() => void queue.fetchNextPage()}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
