'use client';

import { reviewDraft } from '@bookleaf/ai/checks';
import type { AdminTicketDetail } from '@bookleaf/contracts';
import { CircleCheck, SendHorizontal, TriangleAlert, X } from 'lucide-react';
import { type FormEvent, useDeferredValue, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AttachmentPicker, useAttachmentUploads } from '@/components/attachments';
import { LeafGlyph } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { isApiError } from '@/lib/api/client';
import { useAdminReply } from '@/lib/api/queries';
import { cn, newIdempotencyKey } from '@/lib/utils';
import { CheckList, ToneChecks } from './checks';

export interface ComposerValue {
  text: string;
  draftId: string | null;
}

/**
 * The reply editor. While the specialist edits, Leaf's deterministic checks re-run in the browser:
 * every amount, date and ISBN is matched against the author's records, stock phrases and
 * unfinished placeholders are flagged, and the tone checklist updates live.
 */
export function Composer({
  ticket,
  value,
  onChange,
}: {
  ticket: AdminTicketDetail;
  value: ComposerValue;
  onChange: (value: ComposerValue) => void;
}) {
  const send = useAdminReply(ticket.id);
  const uploads = useAttachmentUploads('admin');
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [confirming, setConfirming] = useState<boolean | null>(null);
  const deferred = useDeferredValue(value.text);
  const grounding = ticket.draft?.grounding ?? null;

  const review = useMemo(() => {
    if (!deferred.trim() || !grounding) return null;
    return reviewDraft(deferred, {
      grounding,
      needsEscalation: ticket.draft?.needsEscalation ?? false,
      bookTitle: ticket.book?.title ?? null,
    });
  }, [deferred, grounding, ticket.draft?.needsEscalation, ticket.book?.title]);

  const blocking = review ? review.checks.filter((c) => c.severity === 'error') : [];
  const closed = ticket.status === 'closed';

  async function submit(resolve: boolean, event?: FormEvent) {
    event?.preventDefault();
    const body = value.text.trim();
    if (!body) return;
    if (blocking.length > 0 && confirming !== resolve) {
      setConfirming(resolve);
      return;
    }
    try {
      await send.mutateAsync({
        body,
        resolve,
        draftId: value.draftId ?? undefined,
        attachmentIds: uploads.ids,
        idempotencyKey,
      });
      onChange({ text: '', draftId: null });
      uploads.reset();
      setConfirming(null);
      setIdempotencyKey(newIdempotencyKey());
      toast.success(resolve ? 'Sent and resolved' : 'Reply sent', {
        description: `${ticket.author.name} has been notified.`,
      });
    } catch (error) {
      toast.error('Reply not sent', { description: isApiError(error) ? error.message : 'Please try again.' });
    }
  }

  if (closed) {
    return (
      <p className="rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
        This ticket is closed. The author can open a new query if they need anything else.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => void submit(false, e)}
      className="paper space-y-3 rounded-2xl p-5"
      aria-label="Reply to the author"
    >
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="admin-reply" className="font-display text-xl font-black">
          Reply to {ticket.author.name.split(' ')[0]}
        </label>
        {value.draftId && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-soft px-2.5 py-1 text-[11px] font-bold text-leaf-ink">
            <LeafGlyph className="size-3" /> From Leaf's draft
            <button
              type="button"
              aria-label="Detach from draft"
              className="rounded-full hover:bg-leaf/15"
              onClick={() => onChange({ ...value, draftId: null })}
            >
              <X className="size-3" />
            </button>
          </span>
        )}
      </div>
      <Textarea
        id="admin-reply"
        value={value.text}
        onChange={(e) => {
          setConfirming(null);
          onChange({ ...value, text: e.target.value });
        }}
        rows={9}
        maxLength={5000}
        placeholder="Write your reply, or use Leaf's draft from the panel →"
        className="min-h-48 text-[15px]"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit(false);
        }}
      />

      {review && (
        <div className="space-y-2.5 rounded-xl bg-muted/50 p-3.5">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold">
            <span className="inline-flex items-center gap-1 text-success">
              <CircleCheck className="size-3.5" /> {review.summary.verified} facts verified
            </span>
            {review.summary.unverified > 0 && (
              <span className="inline-flex items-center gap-1 text-warning">
                <TriangleAlert className="size-3.5" /> {review.summary.unverified} to check
              </span>
            )}
            {review.summary.errors > 0 && (
              <span className="inline-flex items-center gap-1 text-danger">
                <TriangleAlert className="size-3.5" /> {review.summary.errors} must fix
              </span>
            )}
          </p>
          <ToneChecks checklist={review.checklist} />
          <CheckList checks={review.checks.filter((c) => c.severity !== 'ok')} limit={6} />
        </div>
      )}

      <AttachmentPicker uploads={uploads} compact />

      {confirming !== null && (
        <p className="rounded-lg bg-danger-soft/70 px-3 py-2 text-[13px] font-medium text-danger">
          {blocking[0]?.message ?? 'There are problems in this reply.'} Press send again to send anyway.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto hidden text-xs text-muted-foreground sm:block">Ctrl + Enter sends</span>
        <Button
          type="button"
          variant="outline"
          disabled={!value.text.trim() || send.isPending || uploads.busy}
          onClick={() => void submit(true)}
          className={cn(confirming === true && 'border-danger text-danger')}
        >
          <CircleCheck /> Send &amp; resolve
        </Button>
        <Button
          type="submit"
          loading={send.isPending}
          disabled={!value.text.trim() || uploads.busy}
          className={cn(confirming === false && 'bg-danger')}
        >
          Send reply <SendHorizontal />
        </Button>
      </div>
    </form>
  );
}
