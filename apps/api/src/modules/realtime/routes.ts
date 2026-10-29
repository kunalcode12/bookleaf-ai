import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf } from '../../http/context';
import type { RealtimeHub } from './hub';

const HEARTBEAT_MS = 25_000;

/**
 * GET /events — Server-Sent Events. Each message is a thin change notification; the web app
 * reacts by refetching through the REST API, so access checks always apply to the data itself.
 * A heartbeat every 25 s keeps proxies (Vercel's idle limit is 120 s) from closing the stream.
 */
export const realtimeRoutes: FastifyPluginAsyncZod<{ hub: RealtimeHub }> = async (app, { hub }) => {
  app.get(
    '/events',
    {
      schema: {
        tags: ['Shared'],
        summary: 'Realtime change stream (Server-Sent Events)',
        description:
          'Streams `event: <type>` / `data: {id,type,ticketId,ticketNumber,at}` messages for changes the caller may see. Reconnect automatically; on reconnect refetch, since events are notifications rather than a log.',
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const session = request.session;
      const headers = {
        ...(reply.getHeaders() as Record<string, string>),
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-request-id': String(request.id),
      };
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, headers);
      res.write(`retry: 4000\nevent: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

      let closed = false;
      const write = (chunk: string) => {
        if (!closed && !res.writableEnded) res.write(chunk);
      };
      const unregister = hub.register({
        actor,
        send: (event) => write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        close: (reason) => {
          write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`);
          cleanup();
          res.end();
        },
      });

      const heartbeat = setInterval(() => write(`: keep-alive ${Date.now()}\n\n`), HEARTBEAT_MS);
      // End the stream when the session token expires; the client refreshes and reconnects.
      const expiresIn = session ? session.expiresAt.getTime() - Date.now() : 0;
      const expiry = setTimeout(
        () => {
          write(`event: session-expired\ndata: {}\n\n`);
          cleanup();
          res.end();
        },
        Math.max(1000, Math.min(expiresIn, 2_147_000_000)),
      );

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(expiry);
        unregister();
      }
      request.raw.on('close', cleanup);
    },
  );
};
