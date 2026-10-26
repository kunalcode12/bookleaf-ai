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

/** Iterates `data:` payloads of a text/event-stream response body. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = rawEvent
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) yield data;
        boundary = buffer.indexOf('\n\n');
      }
      buffer = buffer.replace(/\r\n/g, '\n');
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) yield tail.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}
