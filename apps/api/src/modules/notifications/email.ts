import type { Logger } from 'pino';
import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  readonly kind: 'resend' | 'log';
  send(message: EmailMessage): Promise<void>;
}

/** Resend errors worth retrying; anything else (bad address, unverified domain…) never will succeed. */
const TRANSIENT_ERRORS = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'application_error',
  'internal_server_error',
  'concurrent_idempotent_requests',
]);

/**
 * Transactional email through Resend. Without a verified sending domain Resend only delivers to
 * the account owner, so `redirectTo` (demo/staging) sends every message there instead, noting the
 * intended recipient. Permanent rejections are logged and dropped; transient ones throw so the
 * job queue retries them.
 */
export class ResendEmailSender implements EmailSender {
  readonly kind = 'resend' as const;
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
    private readonly logger: Logger,
    private readonly redirectTo: string | null = null,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const to = this.redirectTo ?? message.to;
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: this.redirectTo ? `[for ${message.to}] ${message.subject}` : message.subject,
      text: this.redirectTo ? `(Demo copy: addressed to ${message.to})\n\n${message.text}` : message.text,
    });
    if (!error) return;
    if (TRANSIENT_ERRORS.has(error.name))
      throw new Error(`Email delivery failed (${error.name}): ${error.message}`);
    this.logger.warn(
      { to, reason: error.name, detail: error.message },
      'email rejected by provider; not retrying',
    );
  }
}

/** Default when no email provider is configured: the message is logged instead of sent. */
export class LogEmailSender implements EmailSender {
  readonly kind = 'log' as const;

  constructor(private readonly logger: Logger) {}

  async send(message: EmailMessage): Promise<void> {
    this.logger.info(
      { to: message.to, subject: message.subject },
      'email (not sent: no provider configured)',
    );
  }
}
