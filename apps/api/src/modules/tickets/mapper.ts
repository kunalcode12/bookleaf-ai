import {
  type AdminTicketListItem,
  type AiDraft,
  type Attachment,
  type AuthorTicketSummary,
  type DraftCheck,
  formatTicketNumber,
  type InternalNote,
  type SlaView,
  type TicketEvent,
  type TicketMessage,
  type TriageView,
} from '@bookleaf/contracts';
import type { schema } from '@bookleaf/db';
import { computeSla, expectedResponseLabel, urgencyScore } from '@bookleaf/domain';
import type { loadDrafts, loadEvents, loadNotes, TicketRow } from './queries';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const isUnresolved = (status: TicketRow['status']) => status === 'open' || status === 'in_progress';

export function slaView(row: TicketRow, now: Date): SlaView {
  const sla = computeSla(
    {
      priority: row.priority,
      status: row.status,
      createdAt: row.createdAt,
      dueAt: row.slaDueAt,
      firstResponseAt: row.firstResponseAt,
    },
    now,
  );
  return {
    dueAt: iso(sla.dueAt),
    state: sla.state,
    minutesRemaining: sla.minutesRemaining,
    targetHours: sla.targetHours,
  };
}

export function bookRef(row: TicketRow) {
  return row.bookId && row.bookExternalId && row.bookTitle && row.bookStage
    ? { id: row.bookId, externalId: row.bookExternalId, title: row.bookTitle, status: row.bookStage }
    : null;
}

export function toAdminListItem(row: TicketRow, now: Date): AdminTicketListItem {
  return {
    id: row.id,
    number: formatTicketNumber(row.number),
    subject: row.subject,
    status: row.status,
    category: row.category,
    categorySource: row.categorySource,
    priority: row.priority,
    prioritySource: row.prioritySource,
    aiSummary: row.aiSummary,
    aiConfidence: row.aiConfidence,
    aiFlags: row.aiFlags,
    triageStatus: row.triageStatus,
    draftStatus: row.draftStatus,
    author: { id: row.authorId, externalId: row.authorExternalId, name: row.authorName },
    book: bookRef(row),
    assignee:
      row.assigneeId && row.assigneeName
        ? { id: row.assigneeId, displayName: row.assigneeName, role: 'admin', title: row.assigneeTitle }
        : null,
    sla: slaView(row, now),
    urgency: urgencyScore(
      {
        priority: row.priority,
        status: row.status,
        createdAt: row.createdAt,
        slaDueAt: row.slaDueAt,
        firstResponseAt: row.firstResponseAt,
      },
      now,
    ),
    messageCount: row.messageCount,
    hasAttachments: Boolean(row.hasAttachments),
    awaitingReply:
      isUnresolved(row.status) &&
      (row.lastAdminMessageAt === null ||
        (row.lastAuthorMessageAt !== null && row.lastAuthorMessageAt > row.lastAdminMessageAt)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    firstResponseAt: iso(row.firstResponseAt),
    lastAuthorMessageAt: iso(row.lastAuthorMessageAt),
  };
}

export function lastActivity(row: TicketRow): Date {
  const times = [row.createdAt, row.lastAdminMessageAt, row.lastAuthorMessageAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  return new Date(Math.max(...times));
}

/** Author view: no priority, no AI internals, no assignee — just what an author needs. */
export function toAuthorSummary(row: TicketRow): AuthorTicketSummary {
  return {
    id: row.id,
    number: formatTicketNumber(row.number),
    subject: row.subject,
    status: row.status,
    category: row.category,
    book: bookRef(row),
    expectedResponse:
      row.status === 'open' && !row.firstResponseAt ? expectedResponseLabel(row.priority) : null,
    hasUnreadReply:
      row.lastAdminMessageAt !== null &&
      (row.authorLastReadAt === null || row.lastAdminMessageAt > row.authorLastReadAt),
    messageCount: row.messageCount,
    lastActivityAt: lastActivity(row).toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

type MessageRow = typeof schema.ticketMessages.$inferSelect;

export function toMessage(message: MessageRow, attachments: Attachment[]): TicketMessage {
  return {
    id: message.id,
    sender: message.senderType,
    senderName: message.senderName,
    senderTitle: message.senderTitle,
    body: message.body,
    attachments,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toNote(note: Awaited<ReturnType<typeof loadNotes>>[number]): InternalNote {
  return {
    id: note.id,
    body: note.body,
    author: { id: note.authorId, displayName: note.authorName, role: 'admin', title: note.authorTitle },
    createdAt: note.createdAt.toISOString(),
  };
}

export function toEvent(event: Awaited<ReturnType<typeof loadEvents>>[number]): TicketEvent {
  return {
    id: String(event.seq),
    type: event.type,
    actor: {
      type: event.actorType,
      id: event.actorId,
      name: event.actorType === 'ai' ? 'Leaf' : event.actorType === 'system' ? 'BookLeaf' : event.actorName,
    },
    visibility: event.visibility,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  };
}

export function triageView(row: TicketRow): TriageView {
  return {
    status: row.triageStatus,
    category: row.category,
    categorySource: row.categorySource,
    secondaryCategory: row.secondaryCategory,
    priority: row.priority,
    prioritySource: row.prioritySource,
    aiCategory: row.aiCategory,
    aiPriority: row.aiPriority,
    confidence: row.aiConfidence,
    summary: row.aiSummary,
    rationale: row.aiRationale,
    sentiment: row.aiSentiment,
    language: row.aiLanguage,
    signals: row.aiSignals ?? null,
    policyAdjustments: row.policyAdjustments ?? [],
    flags: row.aiFlags,
    injection: row.injection ?? null,
    provider: row.triageProvider,
    model: row.triageModel,
    error: row.triageError,
    triagedAt: iso(row.triagedAt),
  };
}

type DraftRows = Awaited<ReturnType<typeof loadDrafts>>;

export function toDraft(rows: DraftRows, threadVersion: number): AiDraft | null {
  const latest = rows.find((r) => r.draft.status !== 'discarded') ?? null;
  if (!latest) return null;
  const d = latest.draft;
  return {
    id: d.id,
    ticketId: d.ticketId,
    version: d.version,
    status: d.status,
    origin: d.origin,
    body: d.body,
    preset: d.preset,
    instruction: d.instruction,
    isStale: d.threadVersion < threadVersion,
    factsUsed: d.factsUsed,
    policiesUsed: d.policiesUsed,
    needsEscalation: d.needsEscalation,
    escalationTeam: d.escalationTeam,
    internalNextSteps: d.internalNextSteps,
    checks: (d.checks ?? []) as DraftCheck[],
    checklist: d.checklist ?? null,
    grounding: d.grounding ?? null,
    provider: d.provider,
    model: d.model,
    latencyMs: d.latencyMs,
    tokens:
      d.inputTokens !== null && d.outputTokens !== null
        ? { input: d.inputTokens, output: d.outputTokens }
        : null,
    error: d.error,
    createdBy:
      d.createdById && latest.creatorName
        ? { id: d.createdById, displayName: latest.creatorName, role: 'admin', title: latest.creatorTitle }
        : null,
    createdAt: d.createdAt.toISOString(),
    versions: rows.map((r) => ({
      id: r.draft.id,
      version: r.draft.version,
      status: r.draft.status,
      origin: r.draft.origin,
      preset: r.draft.preset,
      createdAt: r.draft.createdAt.toISOString(),
    })),
  };
}
