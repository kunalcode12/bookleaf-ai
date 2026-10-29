import { randomUUID } from 'node:crypto';
import type { Attachment, CreateUploadRequest, UploadTarget } from '@bookleaf/contracts';
import { type Database, schema, type Transaction, withActor } from '@bookleaf/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { RequestActor } from '../../http/context';
import { Errors } from '../../lib/errors';
import type { StorageProvider } from './storage';

const { ticketAttachments } = schema;

function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(-80);
  return cleaned || 'file';
}

export interface AttachmentRow {
  id: string;
  ticketId: string | null;
  messageId: string | null;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

/**
 * Attachments upload straight from the browser to storage on a short-lived signed URL, then are
 * "claimed" by the ticket or message they belong to. Claiming verifies the uploader, that the file
 * really exists in storage, and that it is not already attached elsewhere.
 */
export class AttachmentService {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageProvider,
    private readonly logger: Logger,
  ) {}

  async createUpload(actor: RequestActor, input: CreateUploadRequest): Promise<UploadTarget> {
    const id = randomUUID();
    const now = new Date();
    const key = `${actor.profileId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}-${safeFileName(input.fileName)}`;
    await withActor(this.db, actor.db, (tx) =>
      tx.insert(ticketAttachments).values({
        id,
        uploaderId: actor.profileId,
        storageKey: key,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: 'pending',
      }),
    );
    const target = await this.storage.createUploadTarget(key, input.mimeType);
    return {
      attachmentId: id,
      uploadUrl: target.url,
      method: 'PUT',
      headers: target.headers,
      expiresAt: target.expiresAt.toISOString(),
    };
  }

  /** Links uploaded files to a ticket/message inside the caller's transaction. */
  async claim(
    tx: Transaction,
    actor: RequestActor,
    attachmentIds: string[],
    target: { ticketId: string; messageId: string | null },
  ): Promise<void> {
    if (attachmentIds.length === 0) return;
    const unique = [...new Set(attachmentIds)];
    const rows = await tx
      .select({
        id: ticketAttachments.id,
        key: ticketAttachments.storageKey,
        status: ticketAttachments.status,
      })
      .from(ticketAttachments)
      .where(
        and(
          inArray(ticketAttachments.id, unique),
          eq(ticketAttachments.uploaderId, actor.profileId),
          isNull(ticketAttachments.ticketId),
        ),
      );
    if (rows.length !== unique.length) {
      throw Errors.validation([
        { path: 'attachmentIds', message: 'One or more attachments were not found.' },
      ]);
    }
    for (const row of rows) {
      if (!(await this.storage.exists(row.key))) {
        throw Errors.validation([
          { path: 'attachmentIds', message: 'An attachment has not finished uploading. Please try again.' },
        ]);
      }
    }
    await tx
      .update(ticketAttachments)
      .set({ status: 'attached', ticketId: target.ticketId, messageId: target.messageId })
      .where(inArray(ticketAttachments.id, unique));
  }

  async forTicket(tx: Transaction, ticketId: string): Promise<AttachmentRow[]> {
    return tx
      .select({
        id: ticketAttachments.id,
        ticketId: ticketAttachments.ticketId,
        messageId: ticketAttachments.messageId,
        storageKey: ticketAttachments.storageKey,
        fileName: ticketAttachments.fileName,
        mimeType: ticketAttachments.mimeType,
        sizeBytes: ticketAttachments.sizeBytes,
        createdAt: ticketAttachments.createdAt,
      })
      .from(ticketAttachments)
      .where(and(eq(ticketAttachments.ticketId, ticketId), eq(ticketAttachments.status, 'attached')));
  }

  async toDtos(rows: AttachmentRow[]): Promise<Attachment[]> {
    return Promise.all(
      rows.map(async (row) => {
        let url: string | null = null;
        try {
          url = await this.storage.downloadUrl(row.storageKey, row.fileName);
        } catch (error) {
          this.logger.warn({ err: error, attachmentId: row.id }, 'could not sign attachment URL');
        }
        return {
          id: row.id,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          url,
          createdAt: row.createdAt.toISOString(),
        };
      }),
    );
  }
}
