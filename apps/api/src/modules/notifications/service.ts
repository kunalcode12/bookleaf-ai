import type { Notification, NotificationListResponse, NotificationType } from '@bookleaf/contracts';
import { formatTicketNumber } from '@bookleaf/contracts';
import { type Database, SYSTEM_ACTOR, schema, withActor } from '@bookleaf/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Config } from '../../config/env';
import type { RequestActor } from '../../http/context';
import type { JobQueue } from '../../jobs/queue';

const { notifications, tickets, profiles } = schema;

export interface NewNotification {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  ticketId?: string | null;
}

/**
 * In-app notifications (realtime via the database trigger) and the email that accompanies the
 * important ones. Created by the system actor after the triggering transaction commits, so a
 * failed notification can never roll back a ticket change.
 */
export class NotificationService {
  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  async notify(items: NewNotification[]): Promise<void> {
    if (items.length === 0) return;
    try {
      await withActor(this.db, SYSTEM_ACTOR, (tx) =>
        tx.insert(notifications).values(
          items.map((n) => ({
            recipientId: n.recipientId,
            type: n.type,
            title: n.title,
            body: n.body,
            ticketId: n.ticketId ?? null,
          })),
        ),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'failed to create notifications');
    }
  }

  async notifyAdmins(item: Omit<NewNotification, 'recipientId'>, exceptProfileId?: string): Promise<void> {
    const admins = await withActor(
      this.db,
      SYSTEM_ACTOR,
      (tx) => tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, 'admin')),
      { readOnly: true },
    );
    await this.notify(
      admins.filter((a) => a.id !== exceptProfileId).map((a) => ({ ...item, recipientId: a.id })),
    );
  }

  /** The author hears back: in-app notification plus an email linking to the ticket. */
  async authorReplied(input: {
    authorProfileId: string;
    authorEmail: string;
    authorName: string;
    ticketId: string;
    ticketNumber: number;
    subject: string;
    resolved: boolean;
    agentName: string;
  }): Promise<void> {
    const ref = formatTicketNumber(input.ticketNumber);
    await this.notify([
      {
        recipientId: input.authorProfileId,
        type: 'ticket_reply',
        title: input.resolved ? `${ref} has been resolved` : `BookLeaf replied to ${ref}`,
        body: `${input.agentName} replied to "${input.subject}".`,
        ticketId: input.ticketId,
      },
    ]);
    const firstName = input.authorName.split(/\s+/)[0] ?? input.authorName;
    await this.queue
      .send('notify.email', {
        to: input.authorEmail,
        subject: `${ref}: ${input.resolved ? 'resolved' : 'new reply'} — ${input.subject}`,
        text: [
          `Hi ${firstName},`,
          '',
          `${input.agentName} from BookLeaf Author Support has replied to your query "${input.subject}".`,
          '',
          `Read the reply: ${this.config.PUBLIC_APP_URL}/support/${input.ticketId}`,
          '',
          'Warm regards,',
          'BookLeaf Author Support',
        ].join('\n'),
      })
      .catch((error) => this.logger.error({ err: error }, 'failed to enqueue email'));
  }

  async list(actor: RequestActor, limit = 30): Promise<NotificationListResponse> {
    return withActor(
      this.db,
      actor.db,
      async (tx) => {
        const rows = await tx
          .select({
            id: notifications.id,
            type: notifications.type,
            title: notifications.title,
            body: notifications.body,
            ticketId: notifications.ticketId,
            ticketNumber: tickets.number,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
          })
          .from(notifications)
          .leftJoin(tickets, eq(tickets.id, notifications.ticketId))
          .where(eq(notifications.recipientId, actor.profileId))
          .orderBy(desc(notifications.createdAt))
          .limit(limit);
        const [unread] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.recipientId, actor.profileId), isNull(notifications.readAt)));
        const data: Notification[] = rows.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          body: r.body,
          ticketId: r.ticketId,
          ticketNumber: r.ticketNumber ? formatTicketNumber(r.ticketNumber) : null,
          readAt: r.readAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        }));
        return { data, unreadCount: unread?.count ?? 0 };
      },
      { readOnly: true },
    );
  }

  async markRead(actor: RequestActor, ids?: string[]): Promise<void> {
    await withActor(this.db, actor.db, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.recipientId, actor.profileId),
            isNull(notifications.readAt),
            ids && ids.length > 0 ? inArray(notifications.id, ids) : undefined,
          ),
        ),
    );
  }

  /** Clears notifications for a ticket once the recipient has opened it. */
  async markTicketRead(actor: RequestActor, ticketId: string): Promise<void> {
    await withActor(this.db, actor.db, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.recipientId, actor.profileId),
            eq(notifications.ticketId, ticketId),
            isNull(notifications.readAt),
          ),
        ),
    );
  }
}
