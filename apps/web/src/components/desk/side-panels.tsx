'use client';

import {
  type AdminTicketDetail,
  PRODUCTION_STAGE_LABELS,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type TicketCategory,
  type TicketEvent,
  type TicketPriority,
  type TicketStatus,
} from '@bookleaf/contracts';
import { ArrowUpRight, MapPin, StickyNote } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { BookCover } from '@/components/book';
import { LeafGlyph } from '@/components/brand';
import { StatusBadge } from '@/components/ticket-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { isApiError } from '@/lib/api/client';
import { useAddNote } from '@/lib/api/queries';
import { ago, count, money, shortDate, stamp } from '@/lib/format';

export function AuthorContextCard({ ticket }: { ticket: AdminTicketDetail }) {
  const a = ticket.authorContext;
  return (
    <section className="paper rounded-2xl p-5" aria-labelledby="author-title">
      <div className="flex items-center gap-3">
        <Avatar name={a.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 id="author-title" className="truncate font-display text-xl font-black">
            <Link href={`/desk/authors/${a.id}`} className="hover:underline">
              {a.name}
            </Link>
          </h2>
          <p className="truncate text-[13px] text-muted-foreground">
            {a.externalId} · {a.email}
          </p>
        </div>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        {a.city && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" /> {a.city}
          </span>
        )}
        <span>Author since {shortDate(a.joinedDate)}</span>
        {a.phone && <span>{a.phone}</span>}
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-center">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Earned</dt>
          <dd className="figure mt-0.5 text-base font-black">{money(a.totals.royaltyEarned)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Paid</dt>
          <dd className="figure mt-0.5 text-base font-black">{money(a.totals.royaltyPaid)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Pending</dt>
          <dd className="figure mt-0.5 text-base font-black text-accent-ink">
            {money(a.totals.royaltyPending)}
          </dd>
        </div>
      </dl>
      <ul className="mt-4 space-y-3">
        {a.books.map((b) => (
          <li
            key={b.id}
            className={`flex gap-3 rounded-xl p-2 ${ticket.book?.id === b.id ? 'bg-accent-soft/60 ring-1 ring-accent/25' : ''}`}
          >
            <BookCover title={b.title} stage={b.status} size="sm" />
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="truncate font-semibold">{b.title}</p>
              <p className="text-muted-foreground">
                {b.production.isPublished
                  ? `${count(b.copiesSold)} sold · ${money(b.royaltyPending)} pending`
                  : PRODUCTION_STAGE_LABELS[b.status]}
              </p>
              {b.production.isPublished && (
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                  {b.payout.message}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {a.recentTickets.length > 0 && (
        <div className="mt-4 border-t pt-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Other conversations
          </p>
          <ul className="space-y-1.5">
            {a.recentTickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/desk/tickets/${t.number}`}
                  className="flex items-center gap-2 text-[13px] hover:underline"
                >
                  <span className="figure font-bold text-muted-foreground">{t.number}</span>
                  <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                  <StatusBadge status={t.status} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function SimilarTickets({ ticket }: { ticket: AdminTicketDetail }) {
  if (ticket.similarTickets.length === 0) return null;
  return (
    <section className="paper rounded-2xl p-5" aria-labelledby="similar-title">
      <h2 id="similar-title" className="flex items-center gap-2 font-display text-lg font-black">
        <LeafGlyph className="size-4 text-leaf" /> Similar tickets
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Leaf matched these by meaning, not keywords. Possibly one shared cause.
      </p>
      <ul className="mt-3 space-y-2">
        {ticket.similarTickets.map((s) => (
          <li key={s.id}>
            <Link
              href={`/desk/tickets/${s.number}`}
              className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-muted/60"
            >
              <span className="figure w-11 shrink-0 text-center text-sm font-black text-leaf">
                {Math.round(s.similarity * 100)}%
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{s.subject}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {s.number} · {s.authorName} · {ago(s.createdAt)}
                </span>
              </span>
              <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NotesPanel({ ticket }: { ticket: AdminTicketDetail }) {
  const addNote = useAddNote(ticket.id);
  const [body, setBody] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    addNote.mutate(text, {
      onSuccess: () => setBody(''),
      onError: (e) => toast.error('Note not saved', { description: isApiError(e) ? e.message : undefined }),
    });
  };
  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Only the BookLeaf team sees notes. Never the author."
          className="min-h-20 border-medium/30 bg-medium-soft/30"
          aria-label="Internal note"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="soft" loading={addNote.isPending} disabled={!body.trim()}>
            <StickyNote /> Add note
          </Button>
        </div>
      </form>
      {ticket.notes.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {[...ticket.notes].reverse().map((note) => (
            <li key={note.id} className="rounded-xl border border-medium/25 bg-medium-soft/40 p-3.5">
              <p className="whitespace-pre-line text-[14px] leading-relaxed">{note.body}</p>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {note.author.displayName} · {stamp(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function describeEvent(event: TicketEvent): string {
  const p = event.payload as Record<string, unknown>;
  const who =
    event.actor.type === 'ai'
      ? 'Leaf'
      : event.actor.type === 'system'
        ? 'BookLeaf'
        : (event.actor.name ?? 'Someone');
  switch (event.type) {
    case 'ticket.created':
      return `${who} opened the ticket`;
    case 'ticket.triaged':
      return `Leaf triaged it: ${TICKET_CATEGORY_LABELS[p.category as TicketCategory] ?? p.category}, ${TICKET_PRIORITY_LABELS[p.priority as TicketPriority] ?? p.priority}${p.source === 'rules' ? ' (keyword rules)' : ''}`;
    case 'ticket.triage_failed':
      return 'Leaf could not triage the ticket';
    case 'ticket.status_changed':
      return `${who} changed status to ${TICKET_STATUS_LABELS[p.to as TicketStatus] ?? p.to}`;
    case 'ticket.reopened':
      return `${who} reopened the ticket`;
    case 'ticket.category_changed':
      return `${who} set category to ${TICKET_CATEGORY_LABELS[p.to as TicketCategory] ?? p.to}`;
    case 'ticket.priority_changed':
      return `${who} set priority to ${TICKET_PRIORITY_LABELS[p.to as TicketPriority] ?? p.to}${typeof p.reason === 'string' ? `: ${p.reason}` : ''}`;
    case 'ticket.assigned':
      return p.auto
        ? `Assigned to ${p.toName} on first reply`
        : `${who} assigned it to ${p.toName ?? 'a teammate'}`;
    case 'ticket.unassigned':
      return `${who} unassigned the ticket`;
    case 'ticket.message_created':
      return p.sender === 'author'
        ? `${who} replied`
        : `${who} replied${p.fromDraft ? ' (from Leaf’s draft)' : ''}`;
    case 'ticket.note_added':
      return `${who} added an internal note`;
    case 'ticket.draft_ready':
      return p.origin === 'scaffold' ? 'Leaf prepared a policy outline' : 'Leaf prepared a draft';
    case 'ticket.draft_failed':
      return 'Leaf could not finish a draft';
    case 'ticket.feedback':
      return `${who} rated the response ${p.rating === 'up' ? 'helpful' : 'not helpful'}`;
    default:
      return event.type;
  }
}

export function Timeline({ events }: { events: TicketEvent[] }) {
  return (
    <ol className="relative space-y-4 border-l border-dashed border-input pl-5">
      {[...events].reverse().map((event) => (
        <li key={event.id} className="relative">
          <span
            className={`absolute -left-[26px] top-1 size-2.5 rounded-full ring-4 ring-card ${
              event.actor.type === 'ai'
                ? 'bg-leaf'
                : event.visibility === 'internal'
                  ? 'bg-medium'
                  : 'bg-foreground/60'
            }`}
          />
          <p className="text-[13px] leading-snug">{describeEvent(event)}</p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            {stamp(event.createdAt)}
            {event.visibility === 'internal' && (
              <Badge tone="outline" size="sm">
                internal
              </Badge>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}
