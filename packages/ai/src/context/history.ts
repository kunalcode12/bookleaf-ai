import { formatShortDate } from '@bookleaf/domain';
import { redactPii } from '../text/redact';
import { sanitizeUntrusted } from '../text/sanitize';
import { estimateTokens } from '../text/tokens';
import type { TicketInput } from '../types';

export interface ThreadWindow {
  /** Thread text for the prompt (untrusted — the caller wraps it in a nonce-tagged block). */
  text: string;
  tokens: number;
  /** Tokens the full, untrimmed thread would have cost. */
  baselineTokens: number;
  includedMessages: number;
  omittedMessages: number;
  /** All author-written text (sanitised), for grounding "quoted" numbers. */
  authorTexts: string[];
  redactions: number;
  hiddenCharacters: number;
}

export const VERBATIM_MESSAGES = 4;
const MAX_CHARS_PER_MESSAGE = 1500;

/**
 * Builds the conversation section of a prompt. The original query is always included; then the
 * last few messages verbatim. Older messages are represented by the stored rolling summary, so
 * prompt size stays flat however long a thread gets. Author text is sanitised and PII-masked.
 */
export function windowThread(ticket: TicketInput, keepLast = VERBATIM_MESSAGES): ThreadWindow {
  let redactions = 0;
  let hiddenCharacters = 0;
  const authorTexts: string[] = [];

  const clean = (body: string, fromAuthor: boolean) => {
    const sanitized = sanitizeUntrusted(body, MAX_CHARS_PER_MESSAGE);
    hiddenCharacters += sanitized.hiddenCharacters;
    const redacted = redactPii(sanitized.text);
    redactions += redacted.total;
    if (fromAuthor) authorTexts.push(redacted.text);
    return redacted.text;
  };

  const original = `[Author · ${formatShortDate(ticket.createdAt)}] Subject: ${clean(ticket.subject, true)}\n${clean(ticket.description, true)}`;
  const recent = ticket.messages.slice(-keepLast);
  const omitted = ticket.messages.length - recent.length;

  const parts = [original];
  if (omitted > 0) {
    parts.push(
      ticket.contextSummary
        ? `[Summary of ${omitted} earlier message${omitted === 1 ? '' : 's'}] ${ticket.contextSummary}`
        : `[${omitted} earlier message${omitted === 1 ? '' : 's'} omitted]`,
    );
  }
  for (const message of recent) {
    const who =
      message.sender === 'author'
        ? 'Author'
        : message.sender === 'admin'
          ? `BookLeaf (${message.senderName})`
          : 'System';
    parts.push(
      `[${who} · ${formatShortDate(message.createdAt)}] ${clean(message.body, message.sender === 'author')}`,
    );
  }
  const text = parts.join('\n\n');

  const fullThread = [ticket.description, ...ticket.messages.map((m) => m.body)].join('\n\n');
  return {
    text,
    tokens: estimateTokens(text),
    baselineTokens: estimateTokens(fullThread) + 20 * (ticket.messages.length + 1),
    includedMessages: recent.length,
    omittedMessages: omitted,
    authorTexts,
    redactions,
    hiddenCharacters,
  };
}
