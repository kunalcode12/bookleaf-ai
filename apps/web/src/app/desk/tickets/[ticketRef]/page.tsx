'use client';

import { type AiDraft, TICKET_STATUS_LABELS, type TicketStatus } from '@bookleaf/contracts';
import {
  ArrowLeft,
  BookmarkCheck,
  BookOpen,
  ChevronDown,
  ShieldAlert,
  UserCheck,
  UserPlus,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { toast } from 'sonner';
import { Composer, type ComposerValue } from '@/components/desk/composer';
import { DraftPanel } from '@/components/desk/draft-panel';
import { AuthorContextCard, NotesPanel, SimilarTickets, Timeline } from '@/components/desk/side-panels';
import { TriageCard } from '@/components/desk/triage-card';
import { ErrorState } from '@/components/states';
import { Letter } from '@/components/thread';
import { CategoryBadge, PriorityBadge, SlaChip, StatusBadge } from '@/components/ticket-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, Skeleton } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import {
  useAdminTicket,
  useAssignTicket,
  usePromoteReply,
  useSession,
  useTeam,
  useUpdateTicket,
} from '@/lib/api/queries';
import { ago } from '@/lib/format';

function WorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-12 w-2/3" />
      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="space-y-4">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export default function TicketWorkspace({ params }: { params: Promise<{ ticketRef: string }> }) {
  const { ticketRef } = use(params);
  const ticket = useAdminTicket(ticketRef);
  const session = useSession();
  const team = useTeam();
  const update = useUpdateTicket(ticketRef);
  const assign = useAssignTicket(ticketRef);
  const promote = usePromoteReply();
  const [composer, setComposer] = useState<ComposerValue>({ text: '', draftId: null });
  const [conflict, setConflict] = useState<{ assigneeId: string; holder: string } | null>(null);

  if (ticket.isError)
    return (
      <ErrorState
        error={ticket.error}
        onRetry={() => void ticket.refetch()}
        title="Couldn't open this ticket"
      />
    );
  if (!ticket.data) return <WorkspaceSkeleton />;

  const t = ticket.data;
  const me = session.data?.user.id;

  const applyDraft = (draft: AiDraft) => {
    if (composer.text.trim() && !window.confirm('Replace what you have written with Leaf’s draft?')) return;
    setComposer({ text: draft.body ?? '', draftId: draft.id });
    document.getElementById('admin-reply')?.focus();
  };

  const changeStatus = (status: TicketStatus) =>
    update.mutate(
      { patch: { status }, version: t.version },
      {
        onSuccess: () => toast.success(`Marked ${TICKET_STATUS_LABELS[status]}`),
        onError: (error) =>
          toast.error(
            isApiError(error) && error.status === 412
              ? 'Someone else just changed this ticket'
              : "Couldn't change status",
            {
              description: isApiError(error) ? error.message : undefined,
            },
          ),
      },
    );

  const assignTo = (assigneeId: string | null, force = false) =>
    assign.mutate(
      { assigneeId, force },
      {
        onSuccess: (updated) => {
          setConflict(null);
          toast.success(
            updated.assignee
              ? `Assigned to ${updated.assignee.id === me ? 'you' : updated.assignee.displayName}`
              : 'Unassigned',
          );
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'ASSIGNMENT_CONFLICT' && assigneeId) {
            const holder =
              (error.meta.assignee as { displayName?: string } | undefined)?.displayName ?? 'A colleague';
            setConflict({ assigneeId, holder });
          } else {
            toast.error("Couldn't assign", { description: isApiError(error) ? error.message : undefined });
          }
        },
      },
    );

  return (
    <div className="space-y-6">
      <title>{`${t.number} · ${t.subject}`}</title>
      <Link
        href="/desk"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Queue
      </Link>

      <header className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="figure text-base font-black text-muted-foreground">{t.number}</span>
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} source={t.prioritySource} />
            <CategoryBadge category={t.category} source={t.categorySource} />
            <SlaChip sla={t.sla} />
            {t.aiFlags.includes('possible_injection') && (
              <Badge tone="danger">
                <ShieldAlert /> Manipulation attempt
              </Badge>
            )}
          </div>
          <h1 className="font-display text-4xl font-black leading-[1] lg:text-5xl">{t.subject}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Link
              href={`/desk/authors/${t.author.id}`}
              className="font-semibold text-foreground hover:underline"
            >
              {t.author.name}
            </Link>
            <span>{t.author.externalId}</span>
            <span className="inline-flex items-center gap-1">
              <BookOpen className="size-3.5" /> {t.book?.title ?? 'General / Account'}
            </span>
            <span>Opened {ago(t.createdAt)}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {t.assignee ? (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="outline" disabled={assign.isPending}>
                  <Avatar name={t.assignee.displayName} size="sm" />
                  {t.assignee.id === me ? 'Assigned to you' : t.assignee.displayName}
                  <ChevronDown />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Assign to</MenuLabel>
                {team.data?.data.map((member) => (
                  <MenuItem
                    key={member.id}
                    disabled={member.id === t.assignee?.id}
                    onSelect={() => assignTo(member.id, true)}
                  >
                    <UserRound /> {member.id === me ? `${member.displayName} (you)` : member.displayName}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem onSelect={() => assignTo(null)}>Unassign</MenuItem>
              </MenuContent>
            </Menu>
          ) : (
            <Button variant="outline" loading={assign.isPending} onClick={() => assignTo('me')}>
              <UserPlus /> Assign to me
            </Button>
          )}
          {t.allowedTransitions.length > 0 && (
            <Menu>
              <MenuTrigger asChild>
                <Button disabled={update.isPending}>
                  {TICKET_STATUS_LABELS[t.status]} <ChevronDown />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Move to</MenuLabel>
                {t.allowedTransitions.map((status) => (
                  <MenuItem key={status} onSelect={() => changeStatus(status)}>
                    {TICKET_STATUS_LABELS[status]}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="min-w-0 space-y-4">
          <Letter
            sender="author"
            name={t.author.name}
            body={t.description}
            at={t.createdAt}
            attachments={t.attachments}
            viewer="admin"
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
              name={m.senderName}
              title={m.senderTitle}
              body={m.body}
              at={m.createdAt}
              attachments={m.attachments}
              viewer="admin"
              footer={
                m.sender === 'admin' ? (
                  <button
                    type="button"
                    disabled={promote.isPending}
                    onClick={() =>
                      promote.mutate(
                        { messageId: m.id },
                        {
                          onSuccess: () =>
                            toast.success('Saved as a tone example', {
                              description: 'Leaf will use it (anonymised) to calibrate future drafts.',
                            }),
                          onError: (e) =>
                            toast.error("Couldn't save example", {
                              description: isApiError(e) ? e.message : undefined,
                            }),
                        },
                      )
                    }
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-leaf-ink"
                  >
                    <BookmarkCheck className="size-3.5" /> Teach Leaf with this reply
                  </button>
                ) : undefined
              }
            />
          ))}

          <Composer ticket={t} value={composer} onChange={setComposer} />

          <section className="paper rounded-2xl p-5">
            <Tabs defaultValue="notes">
              <TabsList>
                <TabsTrigger value="notes">
                  Internal notes
                  {t.notes.length > 0 && <span className="figure text-xs">{t.notes.length}</span>}
                </TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
              </TabsList>
              <TabsContent value="notes" className="mt-5">
                <NotesPanel ticket={t} />
              </TabsContent>
              <TabsContent value="timeline" className="mt-5">
                <Timeline events={t.events} />
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24">
          <TriageCard ticket={t} />
          <DraftPanel ticket={t} onUse={applyDraft} />
          <AuthorContextCard ticket={t} />
          <SimilarTickets ticket={t} />
        </aside>
      </div>

      <Dialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
        <DialogContent
          title={`${conflict?.holder} is on this ticket`}
          description="Taking it over will notify them. Make sure you're not both replying."
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConflict(null)}>
              Leave it with them
            </Button>
            <Button
              loading={assign.isPending}
              onClick={() => conflict && assignTo(conflict.assigneeId, true)}
            >
              <UserCheck /> Take over
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
