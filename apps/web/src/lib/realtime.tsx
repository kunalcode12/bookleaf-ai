'use client';

import type { RealtimeEvent } from '@bookleaf/contracts';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { refreshSession } from './api/client';
import { keys } from './api/queries';

export type RealtimeStatus = 'connecting' | 'live' | 'polling';

const RealtimeContext = createContext<{ status: RealtimeStatus; lastEvent: RealtimeEvent | null }>({
  status: 'connecting',
  lastEvent: null,
});

export const useRealtimeStatus = () => useContext(RealtimeContext);

/** What each change means for cached data. Events carry ids only; the data is refetched through the API. */
function invalidate(client: QueryClient, event: RealtimeEvent) {
  if (event.type.startsWith('ticket.')) {
    void client.invalidateQueries({ queryKey: ['me', 'tickets'] });
    void client.invalidateQueries({ queryKey: ['me', 'ticket'] });
    void client.invalidateQueries({ queryKey: ['admin', 'tickets'] });
    void client.invalidateQueries({ queryKey: ['admin', 'ticket'] });
    void client.invalidateQueries({ queryKey: keys.stats });
    if (event.type === 'ticket.created' || event.type === 'ticket.status_changed') {
      void client.invalidateQueries({ queryKey: keys.myBooks });
      void client.invalidateQueries({ queryKey: keys.authors });
    }
    return;
  }
  switch (event.type) {
    case 'notification.created':
      void client.invalidateQueries({ queryKey: keys.notifications });
      break;
    case 'alert.created':
    case 'alert.updated':
      void client.invalidateQueries({ queryKey: keys.alerts });
      break;
    case 'ai.health_changed':
      void client.invalidateQueries({ queryKey: keys.aiHealth });
      break;
    case 'kb.updated':
      void client.invalidateQueries({ queryKey: ['admin', 'kb'] });
      break;
  }
}

const EVENT_TYPES = [
  'ticket.created',
  'ticket.triaged',
  'ticket.triage_failed',
  'ticket.status_changed',
  'ticket.reopened',
  'ticket.category_changed',
  'ticket.priority_changed',
  'ticket.assigned',
  'ticket.unassigned',
  'ticket.message_created',
  'ticket.note_added',
  'ticket.draft_ready',
  'ticket.draft_failed',
  'ticket.feedback',
  'notification.created',
  'alert.created',
  'alert.updated',
  'ai.health_changed',
  'kb.updated',
] as const;

/**
 * Live updates over Server-Sent Events. Reconnects with backoff; after repeated failures it falls
 * back to polling (queries refetch every 20 s) so the portal still updates without a refresh.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const failures = useRef(0);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    const startPolling = () => {
      if (pollTimer) return;
      setStatus('polling');
      pollTimer = setInterval(() => {
        void client.invalidateQueries({ queryKey: ['me'] });
        void client.invalidateQueries({ queryKey: ['admin', 'tickets'] });
        void client.invalidateQueries({ queryKey: ['admin', 'ticket'] });
        void client.invalidateQueries({ queryKey: keys.stats });
        void client.invalidateQueries({ queryKey: keys.notifications });
      }, 20_000);
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const connect = () => {
      if (disposed) return;
      source = new EventSource('/api/v1/events', { withCredentials: true });
      source.addEventListener('ready', () => {
        failures.current = 0;
        stopPolling();
        setStatus('live');
        // Anything may have changed while we were disconnected.
        void client.invalidateQueries();
      });
      const onEvent = (message: MessageEvent<string>) => {
        try {
          const event = JSON.parse(message.data) as RealtimeEvent;
          setLastEvent(event);
          invalidate(client, event);
        } catch {
          // Ignore malformed frames; the next refetch reconciles.
        }
      };
      for (const type of EVENT_TYPES) source.addEventListener(type, onEvent as EventListener);
      source.addEventListener('session-expired', () => {
        source?.close();
        void refreshSession().then((ok) => {
          if (ok) connect();
        });
      });
      source.addEventListener('close', () => {
        source?.close();
        retryTimer = setTimeout(connect, 3000);
      });
      source.onerror = () => {
        failures.current += 1;
        if (failures.current >= 3) startPolling();
        if (source?.readyState === EventSource.CLOSED) {
          retryTimer = setTimeout(connect, Math.min(30_000, 2000 * 2 ** failures.current));
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
      stopPolling();
    };
  }, [client]);

  return <RealtimeContext.Provider value={{ status, lastEvent }}>{children}</RealtimeContext.Provider>;
}
