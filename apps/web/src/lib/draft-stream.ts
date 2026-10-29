import type { AiDraft, ProblemDetails, RegenerateDraftRequest } from '@bookleaf/contracts';
import { ApiError, refreshSession } from './api/client';

export interface DraftStreamHandlers {
  onStart?: (info: { draftId: string; version: number }) => void;
  onDelta?: (text: string) => void;
  /** A model failed mid-answer and another took over: discard the partial text. */
  onReset?: () => void;
}

/**
 * Regenerates or refines a Leaf draft and streams it token by token. The endpoint is a POST, so this
 * reads the Server-Sent Events frames from the fetch body instead of using EventSource.
 */
export async function streamDraft(
  ticketRef: string,
  request: RegenerateDraftRequest,
  handlers: DraftStreamHandlers,
  signal?: AbortSignal,
  retry = true,
): Promise<AiDraft> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/admin/tickets/${ticketRef}/draft`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw ApiError.network();
  }
  if (res.status === 401 && retry && (await refreshSession())) {
    return streamDraft(ticketRef, request, handlers, signal, false);
  }
  if (!res.ok || !res.body) {
    const problem = (await res.json().catch(() => ({}))) as Partial<ProblemDetails>;
    throw new ApiError(res.status, problem);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const raw = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || raw === undefined) continue;
      const data = JSON.parse(raw) as Record<string, unknown>;
      switch (event) {
        case 'start':
          handlers.onStart?.(data as { draftId: string; version: number });
          break;
        case 'delta':
          handlers.onDelta?.(String(data.text ?? ''));
          break;
        case 'reset':
          handlers.onReset?.();
          break;
        case 'done':
          return data.draft as AiDraft;
        case 'error':
          throw new ApiError(503, {
            code: (data.code as ProblemDetails['code']) ?? 'AI_UNAVAILABLE',
            detail: String(data.message ?? 'Leaf could not finish this draft.'),
          });
      }
    }
  }
  throw new ApiError(503, {
    code: 'AI_UNAVAILABLE',
    detail: 'The draft stream ended unexpectedly. Please try again.',
  });
}
