import { formatShortDate } from '@bookleaf/domain';
import { VERBATIM_MESSAGES } from '../context/history';
import { AllProvidersFailedError } from '../gateway/errors';
import { createNonce } from '../guards/boundary';
import { buildSummaryUserMessage, SUMMARY_PROMPT_VERSION, SUMMARY_SYSTEM_PROMPT } from '../prompts/summarize';
import { redactPii } from '../text/redact';
import { sanitizeUntrusted } from '../text/sanitize';
import type { CallContext, TicketInput } from '../types';
import type { PipelineDeps } from './deps';

/**
 * Rolling summary of the messages that fall outside the verbatim window. Stored on the ticket and
 * reused, so long conversations cost a constant number of prompt tokens. Returns null when
 * nothing needs summarising or no model is available (the window then notes omitted messages).
 */
export async function runSummary(
  deps: PipelineDeps,
  ticket: TicketInput,
  options: { context?: CallContext; signal?: AbortSignal } = {},
): Promise<{ summary: string; upTo: number } | null> {
  const older = ticket.messages.slice(0, Math.max(0, ticket.messages.length - VERBATIM_MESSAGES));
  if (older.length === 0) return null;
  const conversation = [
    `[Author · ${formatShortDate(ticket.createdAt)}] ${ticket.subject}\n${ticket.description}`,
    ...older.map(
      (m) => `[${m.sender === 'author' ? 'Author' : 'BookLeaf'} · ${formatShortDate(m.createdAt)}] ${m.body}`,
    ),
  ]
    .map((part) => redactPii(sanitizeUntrusted(part, 1500).text).text)
    .join('\n\n');

  try {
    const run = await deps.gateway.run({
      task: 'summarize',
      route: deps.routes.summarize,
      request: {
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildSummaryUserMessage(conversation, createNonce()) }],
        maxOutputTokens: 500,
        temperature: 0.2,
      },
      parse: (text) => {
        const summary = text.trim().replace(/\s+/g, ' ');
        if (summary.length < 20) throw new Error('Summary too short');
        return summary.slice(0, 900);
      },
      timeoutMs: deps.timeouts.summarize,
      promptVersion: SUMMARY_PROMPT_VERSION,
      context: options.context,
      signal: options.signal,
    });
    return { summary: run.value, upTo: older.length };
  } catch (error) {
    if (error instanceof AllProvidersFailedError) return null;
    throw error;
  }
}
