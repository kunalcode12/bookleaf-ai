'use client';

import { type AuthorTicketDetail, TICKET_CATEGORY_LABELS, type TicketStatus } from '@bookleaf/contracts';
import { ArrowLeft, BookOpen, Check, Lock, SendHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, use, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AttachmentPicker, useAttachmentUploads } from '@/components/attachments';
import { ErrorState, InlineNotice } from '@/components/states';
import { Letter } from '@/components/thread';
import { StatusBadge } from '@/components/ticket-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { isApiError } from '@/lib/api/client';
import { useAuthorReply, useMyTicket, useSession, useTicketFeedback } from '@/lib/api/queries';
import { longDate, stamp } from '@/lib/format';
import { cn, newIdempotencyKey } from '@/lib/utils';

const STEPS: Array<{ status: TicketStatus; label: string }> = [
  { status: 'open', label: 'Received' },
  { status: 'in_progress', label: 'Being handled' },
  { status: 'resolved', label: 'Resolved' },
];

function Progress({ ticket }: { ticket: AuthorTicketDetail }) {
  const reached = ticket.status === 'closed' ? 3 : STEPS.findIndex((s) => s.status === ticket.status) + 1;
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
      {STEPS.map((step, i) => {
        const done = i < reached;
        const at = ticket.timeline
          .filter((t) => t.status === step.status || (step.status === 'open' && t.type === 'created'))
          .at(-1)?.at;
        return (
          <li key={step.status} className="flex flex-col gap-2">
            <div
              className={cn(
                'h-1.5 rounded-full',
                done ? (i === reached - 1 ? 'bg-accent' : 'bg-leaf') : 'bg-muted',
              )}
            />
            <div>
              <p
                className={cn(
                  'text-[13px] font-semibold',
                  done ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </p>
              {done && at && <p className="text-[11px] text-muted-foreground">{stamp(at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FeedbackBox({ ticketRef }: { ticketRef: string }) {
  const feedback = useTicketFeedback(ticketRef);
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [comment, setComment] = useState('');
  return (
    <div className="rounded-2xl bg-leaf-soft/70 p-6 ring-1 ring-leaf/15">
      <h2 className="font-display text-2xl font-black text-leaf-ink">How did we do?</h2>
      <p className="mt-1 text-sm text-foreground/75">
        Your rating goes straight to the BookLeaf team and helps us answer better.
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant={rating === 'up' ? 'leaf' : 'outline'} onClick={() => setRating('up')}>
          <ThumbsUp /> Helpful
        </Button>
        <Button variant={rating === 'down' ? 'danger' : 'outline'} onClick={() => setRating('down')}>
          <ThumbsDown /> Not helpful
        </Button>
      </div>
      {rating && (
        <div className="mt-4 space-y-3">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={
              rating === 'up'
                ? 'Anything we did especially well? (optional)'
                : 'What could we have done better? (optional)'
            }
            className="min-h-20 bg-card"
          />
          <Button
            loading={feedback.isPending}
            onClick={() =>
              feedback.mutate(
                { rating, comment: comment.trim() || undefined },
                {
                  onSuccess: () => toast.success('Thank you for the feedback'),
                  onError: (e) => toast.error(isApiError(e) ? e.message : 'Could not save your feedback'),
                },
              )
            }
          >
            Send feedback
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AuthorTicketPage({ params }: { params: Promise<{ ticketRef: string }> }) {
  const { ticketRef } = use(params);
  const ticket = useMyTicket(ticketRef);
  const session = useSession();
  const reply = useAuthorReply(ticketRef);
  const uploads = useAttachmentUploads('me');
  const [body, setBody] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const seenReplies = useRef<number | null>(null);

  // A new reply arrived over the live connection while the author was reading.
  const adminReplies = ticket.data?.messages.filter((m) => m.sender === 'admin').length ?? 0;
  useEffect(() => {
    if (!ticket.data) return;
    if (seenReplies.current !== null && adminReplies > seenReplies.current) {
      const latest = ticket.data.messages.filter((m) => m.sender === 'admin').at(-1);
      toast(`New reply from ${latest?.senderName ?? 'BookLeaf'}`, { description: ticket.data.subject });
    }
    seenReplies.current = adminReplies;
  }, [adminReplies, ticket.data]);

  if (ticket.isError) {
    return (
      <ErrorState
        error={ticket.error}
        onRetry={() => void ticket.refetch()}
        title="We couldn't open this conversation"
      />
    );
  }
  if (!ticket.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-14 w-3/4" />
        <Skeleton className="h-10" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  const t = ticket.data;
  const authorName = session.data?.user.displayName ?? 'You';
  const lastAdmin = [...t.messages].reverse().find((m) => m.sender === 'admin');

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    try {
      await reply.mutateAsync({ body: body.trim(), attachmentIds: uploads.ids, idempotencyKey });
      setBody('');
      uploads.reset();
      setIdempotencyKey(newIdempotencyKey());
      toast.success(t.status === 'resolved' ? 'Reopened and sent' : 'Reply sent');
    } catch (error) {
      toast.error('Your reply was not sent', {
        description: isApiError(error) ? error.message : 'Please try again.',
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <title>{`${t.number} · ${t.subject}`}</title>
      <Link
        href="/support"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All conversations
      </Link>

      <header className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="figure text-sm font-bold text-muted-foreground">{t.number}</span>
          <StatusBadge status={t.status} />
          {t.category && <Badge tone="outline">{TICKET_CATEGORY_LABELS[t.category]}</Badge>}
          {t.book ? (
            <Badge tone="neutral">
              <BookOpen /> {t.book.title}
            </Badge>
          ) : (
            <Badge tone="neutral">General / Account</Badge>
          )}
        </div>
        <h1 className="font-display text-4xl font-black leading-[1] sm:text-5xl">{t.subject}</h1>
        <p className="text-sm text-muted-foreground">
          Opened {longDate(t.createdAt)}
          {t.status === 'open' && t.expectedResponse && ` · we usually reply ${t.expectedResponse}`}
        </p>
        <Progress ticket={t} />
      </header>

      <div className="space-y-4">
        <Letter
          sender="author"
          name={authorName}
          body={t.description}
          at={t.createdAt}
          attachments={t.attachments}
          viewer="author"
          label={
            <Badge tone="outline" size="sm">
              Original query
            </Badge>
          }
        />
        {t.messages.map((m) => (
          <Letter
            key={m.id}
            sender={m.sender}
            name={m.sender === 'author' ? authorName : m.senderName}
            title={m.senderTitle}
            body={m.body}
            at={m.createdAt}
            attachments={m.attachments}
            viewer="author"
            highlight={m.id === lastAdmin?.id && t.hasUnreadReply}
          />
        ))}
        {t.messages.length === 0 && (
          <InlineNotice tone="info" icon={<Check />} title="We've got your query">
            It's in the BookLeaf queue
            {t.expectedResponse ? ` and we usually reply ${t.expectedResponse}` : ''}. This page updates by
            itself the moment we reply. No need to refresh.
          </InlineNotice>
        )}
      </div>

      {t.canGiveFeedback && <FeedbackBox ticketRef={t.id} />}
      {t.feedback && (
        <InlineNotice
          tone="leaf"
          icon={t.feedback.rating === 'up' ? <ThumbsUp /> : <ThumbsDown />}
          title="Thanks for your feedback"
        >
          {t.feedback.comment ?? 'Your rating was shared with the BookLeaf team.'}
        </InlineNotice>
      )}

      {t.canReply ? (
        <form onSubmit={send} className="paper space-y-3 rounded-2xl p-5">
          <label htmlFor="reply" className="text-sm font-semibold">
            {t.status === 'resolved' ? 'Still need help? Reply to reopen this conversation' : 'Add a reply'}
          </label>
          <Textarea
            id="reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Write your message…"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send(e);
            }}
          />
          <AttachmentPicker uploads={uploads} compact />
          <div className="flex items-center justify-between gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">Ctrl + Enter to send</span>
            <Button type="submit" loading={reply.isPending} disabled={!body.trim() || uploads.busy}>
              {t.status === 'resolved' ? 'Reopen & send' : 'Send reply'} <SendHorizontal />
            </Button>
          </div>
        </form>
      ) : (
        <InlineNotice tone="info" icon={<Lock />} title="This conversation is closed">
          Need anything else?{' '}
          <Link href="/support/new" className="font-semibold underline underline-offset-2">
            Open a new query
          </Link>{' '}
          and we'll pick it up.
        </InlineNotice>
      )}
    </div>
  );
}
