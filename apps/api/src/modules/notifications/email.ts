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

/** Transactional email through Resend (requires a verified sending domain for arbitrary recipients). */
export class ResendEmailSender implements EmailSender {
  readonly kind = 'resend' as const;
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    if (error) throw new Error(`Email delivery failed: ${error.message}`);
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
