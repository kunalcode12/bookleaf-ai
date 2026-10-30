import { ProviderError } from './errors';
import type { ProviderId } from './types';

export type FetchLike = typeof fetch;

/** Wraps fetch so network failures and aborts surface as classified ProviderErrors. */
export async function providerFetch(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  meta: { provider: ProviderId; model: string },
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const aborted = init.signal?.aborted;
    const reason = init.signal?.reason;
    if (aborted && reason instanceof ProviderError) throw reason;
    if (aborted) {
      const isTimeout = reason instanceof Error && reason.name === 'TimeoutError';
      throw new ProviderError(
        isTimeout ? 'timeout' : 'aborted',
        isTimeout ? 'Request timed out' : 'Request aborted',
        {
          ...meta,
          cause: error,
        },
      );
    }
    throw new ProviderError('network', `Network error: ${(error as Error).message}`, {
      ...meta,
      cause: error,
    });
  }
}

/**
 * Iterates `data:` payloads of a text/event-stream response body. Lines may end in CRLF (Google's
 * servers send `\r\n\r\n` between events), LF or CR, so line ends are normalised before events are
 * split on blank lines; a CR closing a read may be half of a CRLF, so it waits for the next read.
 * At end of stream every remaining event is flushed, including a last one without its blank line.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const held = !done && buffer.endsWith('\r') ? '\r' : '';
      const events = buffer
        .slice(0, buffer.length - held.length)
        .replace(/\r\n?/g, '\n')
        .split('\n\n');
      buffer = (done ? '' : events.pop()!) + held;
      for (const event of events) {
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) yield data;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
