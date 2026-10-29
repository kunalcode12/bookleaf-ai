'use client';

import {
  type AssistResponse,
  CreateTicketRequestSchema,
  LIMITS,
  TICKET_CATEGORY_LABELS,
} from '@bookleaf/contracts';
import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleQuestionMark,
  SendHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AttachmentPicker, useAttachmentUploads } from '@/components/attachments';
import { LeafBadge } from '@/components/brand';
import { LeafThinking } from '@/components/leaf';
import { InlineNotice } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { useAskLeaf, useAssistFeedback, useCreateTicket, useMyBooks } from '@/lib/api/queries';
import { cn, newIdempotencyKey } from '@/lib/utils';

const GENERAL = '__general';
const TOPIC_SUBJECTS: Record<string, string> = {
  royalty: 'Question about my royalty payout',
};

function LeafAnswer({
  answer,
  onUseSummary,
  onFeedback,
  feedback,
}: {
  answer: AssistResponse;
  onUseSummary: () => void;
  onFeedback: (helpful: boolean) => void;
  feedback: boolean | null;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="rounded-xl bg-card p-4 text-[15px] leading-relaxed shadow-page ring-1 ring-leaf/15">
        <p className="whitespace-pre-line">{answer.answer}</p>
        {answer.sources.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-dashed pt-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              From
            </span>
            {answer.sources.map((s) => (
              <span
                key={s.slug}
                className="rounded-md bg-leaf-soft px-2 py-0.5 text-xs font-semibold text-leaf-ink"
              >
                {s.title}
              </span>
            ))}
          </div>
        )}
      </div>
      {answer.origin === 'fallback' && (
        <p className="text-xs text-muted-foreground">
          Leaf's AI is busy, so this answer comes straight from BookLeaf's policy notes.
        </p>
      )}
      {answer.needsHuman ? (
        <div className="rounded-xl border border-accent/30 bg-accent-soft/60 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-accent-ink">
            <Users className="size-4" /> This one needs the BookLeaf team
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">
            {answer.suggestedCategory
              ? `Leaf will route it to ${TICKET_CATEGORY_LABELS[answer.suggestedCategory]}.`
              : 'A specialist will look into your records.'}{' '}
            {answer.suggestedTicket ? 'Leaf has written it up for you.' : ''}
          </p>
          {answer.suggestedTicket && (
            <Button size="sm" variant="accent" className="mt-3" onClick={onUseSummary}>
              <Sparkles /> Use Leaf's write-up
            </Button>
          )}
        </div>
      ) : feedback === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Did this answer your question?</span>
          <Button size="sm" variant="outline" onClick={() => onFeedback(true)}>
            <ThumbsUp /> Yes, thanks
          </Button>
          <Button size="sm" variant="outline" onClick={() => onFeedback(false)}>
            <ThumbsDown /> Not quite
          </Button>
        </div>
      ) : feedback ? (
        <InlineNotice tone="leaf" icon={<Check />} title="Glad that helped!">
          No need to send a query. Your question and Leaf's answer stay private to you.
        </InlineNotice>
      ) : (
        <InlineNotice tone="info" icon={<Users />} title="Let's get a person on it">
          Send your query and a BookLeaf specialist will pick it up.
        </InlineNotice>
      )}
    </motion.div>
  );
}

export function NewQuery() {
  const router = useRouter();
  const params = useSearchParams();
  const books = useMyBooks();
  const create = useCreateTicket();
  const ask = useAskLeaf();
  const assistFeedback = useAssistFeedback();
  const uploads = useAttachmentUploads('me');
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const [bookId, setBookId] = useState<string>(params.get('book') ?? GENERAL);
  const [subject, setSubject] = useState(TOPIC_SUBJECTS[params.get('topic') ?? ''] ?? '');
  const [description, setDescription] = useState(params.get('ask') ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const autoAsked = useRef(false);

  const question = [subject, description].filter((s) => s.trim()).join('\n\n');
  const canAsk = question.trim().length >= LIMITS.assistQuestion.min;

  const runAsk = (text = question) => {
    setFeedback(null);
    ask.mutate({
      question: text.slice(0, LIMITS.assistQuestion.max),
      bookId: bookId === GENERAL ? null : bookId,
    });
  };

  // Arriving from "Ask Leaf" on the home page: answer straight away.
  useEffect(() => {
    const initial = params.get('ask');
    if (initial && !autoAsked.current && books.data) {
      autoAsked.current = true;
      ask.mutate({ question: initial.slice(0, LIMITS.assistQuestion.max), bookId: params.get('book') });
    }
  }, [params, books.data, ask]);

  const applySummary = () => {
    const suggestion = ask.data?.suggestedTicket;
    if (!suggestion) return;
    setSubject(suggestion.subject.slice(0, LIMITS.subject.max));
    setDescription(suggestion.description.slice(0, LIMITS.description.max));
    if (suggestion.bookId) setBookId(suggestion.bookId);
    setErrors({});
    descriptionRef.current?.focus();
  };

  const onFeedback = (helpful: boolean) => {
    setFeedback(helpful);
    if (ask.data) assistFeedback.mutate({ messageId: ask.data.messageId, helpful });
    if (!helpful) descriptionRef.current?.focus();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      bookId: bookId === GENERAL ? null : bookId,
      subject,
      description,
      attachmentIds: uploads.ids,
    };
    const parsed = CreateTicketRequestSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      const ticket = await create.mutateAsync({ body, idempotencyKey });
      setIdempotencyKey(newIdempotencyKey());
      toast.success(`Query ${ticket.number} sent`, {
        description: ticket.expectedResponse
          ? `We usually reply ${ticket.expectedResponse}. You'll be notified here and by email.`
          : "We'll reply here and email you as soon as we do.",
      });
      router.push(`/support/${ticket.id}`);
    } catch (error) {
      if (isApiError(error) && error.fieldErrors.length > 0) {
        const next: Record<string, string> = {};
        for (const f of error.fieldErrors) next[f.path] ??= f.message;
        setErrors(next);
      } else {
        toast.error("Your query wasn't sent", {
          description: isApiError(error) ? error.message : 'Please try again in a moment.',
        });
      }
    }
  }

  const bookOptions = [
    ...(books.data?.data ?? []).map((b) => ({ value: b.id, label: b.title, hint: b.statusLabel })),
    { value: GENERAL, label: 'General / Account Level', hint: 'Bank details, packages, your account…' },
  ];

  return (
    <div className="space-y-10">
      <title>New query · BookLeaf</title>
      <Link
        href="/support"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Support
      </Link>
      <header>
        <h1 className="font-display text-5xl font-black leading-[0.95] md:text-6xl">
          What can we help with?
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Tell us what's going on. The more specific you are (dates, amounts, links), the faster we can sort
          it out.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_24rem] lg:items-start">
        <form onSubmit={submit} className="paper space-y-6 rounded-2xl p-6 sm:p-8" noValidate>
          <Field id="book" label="Which book is this about?" error={errors.bookId}>
            {books.isPending ? (
              <Skeleton className="h-11" />
            ) : (
              <Select
                id="book"
                value={bookId}
                onValueChange={setBookId}
                options={bookOptions}
                aria-label="Book"
              />
            )}
          </Field>
          <Field
            id="subject"
            label="Subject"
            error={errors.subject}
            counter={`${subject.length}/${LIMITS.subject.max}`}
          >
            <Input
              id="subject"
              value={subject}
              maxLength={LIMITS.subject.max}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. My October royalty hasn't arrived"
              aria-invalid={Boolean(errors.subject) || undefined}
            />
          </Field>
          <Field
            id="description"
            label="Describe the issue"
            error={errors.description}
            hint="Include anything that helps: order numbers, platform links, what you've already tried."
            counter={`${description.length}/${LIMITS.description.max}`}
          >
            <Textarea
              id="description"
              ref={descriptionRef}
              value={description}
              maxLength={LIMITS.description.max}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              placeholder="What happened, and when?"
              aria-invalid={Boolean(errors.description) || undefined}
            />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Attachments (optional)</p>
            <AttachmentPicker uploads={uploads} />
            {errors.attachmentIds && (
              <p className="text-[13px] font-medium text-danger">{errors.attachmentIds}</p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <BookOpen className="size-4" /> A specialist replies here, and we email you when they do.
            </p>
            <Button type="submit" size="lg" loading={create.isPending} disabled={uploads.busy}>
              {uploads.busy ? 'Uploading…' : 'Send to BookLeaf'} <SendHorizontal />
            </Button>
          </div>
        </form>

        <aside
          className="rounded-2xl bg-leaf-soft/70 p-6 ring-1 ring-leaf/15 lg:sticky lg:top-24"
          aria-labelledby="ask-leaf-title"
        >
          <LeafBadge label="Ask Leaf first" />
          <h2
            id="ask-leaf-title"
            className="mt-4 font-display text-2xl font-black leading-tight text-leaf-ink"
          >
            Many questions have an instant answer.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/75">
            Leaf reads BookLeaf's policies and your own book records, never guesses, and tells you plainly
            when a person needs to step in.
          </p>

          <div className="mt-5">
            <AnimatePresence mode="wait">
              {ask.isPending ? (
                <motion.div key="thinking" exit={{ opacity: 0 }}>
                  <LeafThinking
                    steps={[
                      'Reading your book records…',
                      'Checking BookLeaf policy…',
                      'Writing your answer…',
                    ]}
                  />
                </motion.div>
              ) : ask.isError ? (
                <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <InlineNotice
                    tone="warning"
                    icon={<CircleQuestionMark />}
                    title="Leaf can't answer right now"
                  >
                    {isApiError(ask.error) && ask.error.code === 'RATE_LIMITED'
                      ? "You've asked a lot of questions in a short time. Send your query and the team will reply."
                      : 'Send your query and a BookLeaf specialist will reply.'}
                  </InlineNotice>
                </motion.div>
              ) : ask.data ? (
                <LeafAnswer
                  key={ask.data.messageId}
                  answer={ask.data}
                  onUseSummary={applySummary}
                  onFeedback={onFeedback}
                  feedback={feedback}
                />
              ) : null}
            </AnimatePresence>
          </div>

          <Button
            type="button"
            variant="leaf"
            size="lg"
            className={cn(
              'mt-5 w-full',
              ask.data && 'bg-card text-leaf-ink ring-1 ring-leaf/25 hover:bg-card/80',
            )}
            disabled={!canAsk || ask.isPending}
            onClick={() => runAsk()}
          >
            <Sparkles /> {ask.data ? 'Ask again with my edits' : 'Ask Leaf about this'}
          </Button>
          {!canAsk && (
            <p className="mt-2 text-center text-xs text-muted-foreground">Write a sentence or two first.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
