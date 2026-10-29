import type { RealtimeEvent, RealtimeEventType } from '@bookleaf/contracts';
import type { DatabaseHandle } from '@bookleaf/db';
import type { Logger } from 'pino';
import type { RequestActor } from '../../http/context';

export const EVENTS_CHANNEL = 'bookleaf_events';
const MAX_STREAMS_PER_PROFILE = 5;

/** Payload published on the Postgres channel (by triggers or `publish`). */
export interface ChannelEvent {
  id: string;
  type: RealtimeEventType;
  ticketId: string | null;
  ticketNumber: string | null;
  authorId: string | null;
  recipientId: string | null;
  visibility: 'public' | 'internal' | 'private';
  at: string;
}

export interface StreamClient {
  actor: RequestActor;
  send(event: RealtimeEvent): void;
  close(reason: string): void;
}

/**
 * Who may hear about what:
 *  - authors: public events on their own tickets, plus notifications addressed to them;
 *  - admins: every ticket and system event, plus their own notifications.
 * Internal events (notes, triage, drafts) never reach an author's stream.
 */
export function canReceive(actor: RequestActor, event: ChannelEvent): boolean {
  if (event.visibility === 'private') return event.recipientId === actor.profileId;
  if (actor.role === 'admin') return true;
  return event.visibility === 'public' && event.authorId !== null && event.authorId === actor.authorId;
}

/** What actually goes over the wire: ids and a type, never record contents. */
function toWire(event: ChannelEvent): RealtimeEvent {
  return {
    id: event.id,
    type: event.type,
    ticketId: event.ticketId,
    ticketNumber: event.ticketNumber,
    at: event.at,
  };
}

/**
 * One LISTEN connection per API process fans committed database changes out to the SSE clients
 * allowed to see them. Because NOTIFY is delivered to every listening process, this works
 * unchanged with several API instances behind a load balancer.
 */
export class RealtimeHub {
  private readonly clients = new Set<StreamClient>();
  private unlisten: (() => Promise<void>) | null = null;

  constructor(
    private readonly handle: DatabaseHandle,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    try {
      this.unlisten = await this.handle.listen(EVENTS_CHANNEL, (payload) => this.dispatch(payload));
    } catch (error) {
      // e.g. a transaction-mode pooler that cannot LISTEN: clients fall back to polling.
      this.logger.warn({ err: error }, 'realtime LISTEN unavailable; clients will poll');
    }
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.close('server_shutdown');
    this.clients.clear();
    await this.unlisten?.().catch(() => undefined);
    this.unlisten = null;
  }

  get connections(): number {
    return this.clients.size;
  }

  get listening(): boolean {
    return this.unlisten !== null;
  }

  register(client: StreamClient): () => void {
    const mine = [...this.clients].filter((c) => c.actor.profileId === client.actor.profileId);
    if (mine.length >= MAX_STREAMS_PER_PROFILE) mine[0]?.close('too_many_streams');
    this.clients.add(client);
    return () => {
      this.clients.delete(client);
    };
  }

  private dispatch(payload: string) {
    let event: ChannelEvent;
    try {
      event = JSON.parse(payload) as ChannelEvent;
    } catch {
      this.logger.warn({ payload }, 'ignoring malformed realtime payload');
      return;
    }
    const wire = toWire(event);
    for (const client of this.clients) {
      if (!canReceive(client.actor, event)) continue;
      try {
        client.send(wire);
      } catch (error) {
        this.logger.debug({ err: error }, 'dropping broken realtime client');
        this.clients.delete(client);
      }
    }
  }

  /** Publishes an application-level event (ones not produced by database triggers). */
  async publish(event: Omit<ChannelEvent, 'id' | 'at'> & { id?: string }): Promise<void> {
    const full: ChannelEvent = {
      ...event,
      id: event.id ?? `x-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
    };
    try {
      await this.handle.notify(EVENTS_CHANNEL, JSON.stringify(full));
    } catch (error) {
      this.logger.warn({ err: error }, 'failed to publish realtime event');
    }
  }
}
