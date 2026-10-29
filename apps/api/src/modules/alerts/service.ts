import {
  formatTicketNumber,
  type IncidentAlert,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  type TicketCategory,
} from '@bookleaf/contracts';
import { type Database, rowsOf, SYSTEM_ACTOR, schema, withActor } from '@bookleaf/db';
import { toIsoDate } from '@bookleaf/domain';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { RequestActor } from '../../http/context';
import type { Clock } from '../../lib/clock';
import { Errors } from '../../lib/errors';

const { incidentAlerts, tickets, profiles } = schema;

const CLUSTER_SIMILARITY = 0.85;
const CLUSTER_MIN_SIZE = 3;
const SPIKE_MIN_COUNT = 5;
const SPIKE_FACTOR = 3;

interface ClusterRow {
  id: string;
  number: number;
  ai_summary: string | null;
  subject: string;
  category: TicketCategory | null;
  similarity: number;
  created_at: Date | string;
}

/**
 * Turns individual tickets into an operational signal: several near-identical tickets in a short
 * window ("my book is unavailable on Amazon") usually mean one underlying incident — a platform
 * sync failure, a misprinted batch — that the team should fix once instead of ticket by ticket.
 */
export class AlertService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** After a ticket is embedded: is it part of a cluster of similar open tickets? */
  async checkCluster(ticketId: string): Promise<void> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - 48 * 3_600_000);
    await withActor(this.db, SYSTEM_ACTOR, async (tx) => {
      const result = await tx.execute(sql`
        select other.id, other.number, other.ai_summary, other.subject, other.category, other.created_at,
               1 - (other.embedding <=> self.embedding) as similarity
          from ${tickets} self
          join ${tickets} other on other.embedding is not null
         where self.id = ${ticketId} and self.embedding is not null
           and other.created_at >= ${since}::timestamptz
           and other.status in ('open', 'in_progress')
         order by other.embedding <=> self.embedding
         limit 25`);
      const cluster = rowsOf<ClusterRow>(result).filter((r) => Number(r.similarity) >= CLUSTER_SIMILARITY);
      if (cluster.length < CLUSTER_MIN_SIZE) return;

      const ordered = [...cluster].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const anchor = ordered[0]!;
      const categories = ordered.map((r) => r.category).filter((c): c is TicketCategory => Boolean(c));
      const category = categories.sort(
        (a, b) => categories.filter((c) => c === b).length - categories.filter((c) => c === a).length,
      )[0];
      const fingerprint = `cluster:${anchor.id}`;
      const title = `${cluster.length} similar tickets in 48 hours`;
      const summary = `${anchor.ai_summary ?? anchor.subject} — likely one underlying issue. Tickets: ${ordered
        .map((r) => formatTicketNumber(Number(r.number)))
        .join(', ')}.`;
      const ids = ordered.map((r) => r.id);

      // Merge into an existing alert that already covers any of these tickets.
      const [existing] = await tx
        .select({ id: incidentAlerts.id, status: incidentAlerts.status, ticketIds: incidentAlerts.ticketIds })
        .from(incidentAlerts)
        .where(
          and(eq(incidentAlerts.kind, 'similar_cluster'), sql`${incidentAlerts.ticketIds} && ${ids}::uuid[]`),
        )
        .orderBy(desc(incidentAlerts.createdAt))
        .limit(1);
      if (existing) {
        const merged = [...new Set([...existing.ticketIds, ...ids])];
        if (merged.length === existing.ticketIds.length) return;
        await tx
          .update(incidentAlerts)
          .set({
            ticketIds: merged,
            title: `${merged.length} similar tickets in 48 hours`,
            summary,
            status: existing.status === 'resolved' ? 'open' : existing.status,
          })
          .where(eq(incidentAlerts.id, existing.id));
        return;
      }
      await tx
        .insert(incidentAlerts)
        .values({
          kind: 'similar_cluster',
          fingerprint,
          title,
          summary,
          category: category ?? null,
          ticketIds: ids,
        })
        .onConflictDoNothing({ target: incidentAlerts.fingerprint });
      this.logger.info({ fingerprint, size: cluster.length }, 'incident alert raised (similar tickets)');
    });
  }

  /** Scheduled: unusual volume per category versus the previous week. */
  async scan(): Promise<void> {
    const now = this.clock.now();
    const dayAgo = new Date(now.getTime() - 24 * 3_600_000);
    const weekAgo = new Date(now.getTime() - 8 * 24 * 3_600_000);
    await withActor(this.db, SYSTEM_ACTOR, async (tx) => {
      const rows = await tx
        .select({
          category: tickets.category,
          recent: sql<number>`count(*) filter (where ${tickets.createdAt} >= ${dayAgo}::timestamptz)::int`,
          previous: sql<number>`count(*) filter (where ${tickets.createdAt} < ${dayAgo}::timestamptz)::int`,
        })
        .from(tickets)
        .where(
          and(sql`${tickets.createdAt} >= ${weekAgo}::timestamptz`, sql`${tickets.category} is not null`),
        )
        .groupBy(tickets.category);

      for (const row of rows) {
        if (!row.category || !TICKET_CATEGORIES.includes(row.category)) continue;
        const baseline = row.previous / 7;
        if (row.recent < SPIKE_MIN_COUNT || row.recent < SPIKE_FACTOR * Math.max(1, baseline)) continue;
        const latest = await tx
          .select({ id: tickets.id })
          .from(tickets)
          .where(and(eq(tickets.category, row.category), sql`${tickets.createdAt} >= ${dayAgo}::timestamptz`))
          .orderBy(desc(tickets.createdAt))
          .limit(25);
        const label = TICKET_CATEGORY_LABELS[row.category];
        await tx
          .insert(incidentAlerts)
          .values({
            kind: 'category_spike',
            fingerprint: `spike:${row.category}:${toIsoDate(now)}`,
            title: `${row.recent} ${label} tickets in 24 hours`,
            summary: `${
              baseline < 0.5
                ? 'There were almost none in the previous week.'
                : `That's ${(row.recent / baseline).toFixed(1)}× the usual ${baseline.toFixed(1)} a day.`
            } Check for a shared cause before answering them one by one.`,
            category: row.category,
            ticketIds: latest.map((t) => t.id),
          })
          .onConflictDoUpdate({
            target: incidentAlerts.fingerprint,
            set: {
              title: `${row.recent} ${label} tickets in 24 hours`,
              ticketIds: latest.map((t) => t.id),
            },
          });
      }
    });
  }

  async list(actor: RequestActor, includeResolved = false): Promise<IncidentAlert[]> {
    return withActor(
      this.db,
      actor.db,
      async (tx) => {
        const alerts = await tx
          .select({ alert: incidentAlerts, ackName: profiles.displayName, ackTitle: profiles.title })
          .from(incidentAlerts)
          .leftJoin(profiles, eq(profiles.id, incidentAlerts.acknowledgedById))
          .where(includeResolved ? undefined : ne(incidentAlerts.status, 'resolved'))
          .orderBy(desc(incidentAlerts.updatedAt))
          .limit(20);
        const ids = [...new Set(alerts.flatMap((a) => a.alert.ticketIds))];
        const ticketRows =
          ids.length > 0
            ? await tx
                .select({
                  id: tickets.id,
                  number: tickets.number,
                  subject: tickets.subject,
                  status: tickets.status,
                })
                .from(tickets)
                .where(inArray(tickets.id, ids))
            : [];
        const byId = new Map(ticketRows.map((t) => [t.id, t]));
        return alerts.map(({ alert, ackName, ackTitle }) => ({
          id: alert.id,
          kind: alert.kind,
          status: alert.status,
          title: alert.title,
          summary: alert.summary,
          category: alert.category,
          ticketCount: alert.ticketIds.length,
          tickets: alert.ticketIds
            .map((id) => byId.get(id))
            .filter((t): t is NonNullable<typeof t> => Boolean(t))
            .map((t) => ({
              id: t.id,
              number: formatTicketNumber(t.number),
              subject: t.subject,
              status: t.status,
            })),
          acknowledgedBy:
            alert.acknowledgedById && ackName
              ? { id: alert.acknowledgedById, displayName: ackName, role: 'admin' as const, title: ackTitle }
              : null,
          createdAt: alert.createdAt.toISOString(),
          updatedAt: alert.updatedAt.toISOString(),
        }));
      },
      { readOnly: true },
    );
  }

  async update(actor: RequestActor, id: string, status: 'acknowledged' | 'resolved'): Promise<void> {
    const updated = await withActor(this.db, actor.db, (tx) =>
      tx
        .update(incidentAlerts)
        .set({ status, acknowledgedById: actor.profileId })
        .where(eq(incidentAlerts.id, id))
        .returning({ id: incidentAlerts.id }),
    );
    if (updated.length === 0) throw Errors.notFound('Alert');
  }
}
