'use client';

import { type Attachment, LIMITS, type UploadTarget } from '@bookleaf/contracts';
import { FileText, Image as ImageIcon, LoaderCircle, Paperclip, TriangleAlert, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { type FileRejection, useDropzone } from 'react-dropzone';
import { ApiError, api } from '@/lib/api/client';
import { fileSize } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PendingUpload {
  key: string;
  file: File;
  status: 'uploading' | 'done' | 'error';
  attachmentId?: string;
  error?: string;
}

/** Signed upload: ask the API for a short-lived URL, then PUT the file straight to storage. */
async function upload(file: File, scope: 'me' | 'admin'): Promise<string> {
  const target = await api.post<UploadTarget>(`/${scope}/attachments`, {
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  let res: Response;
  try {
    res = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: target.headers,
      body: file,
      credentials: 'same-origin',
    });
  } catch {
    throw ApiError.network();
  }
  if (!res.ok) throw new ApiError(res.status, { detail: 'The upload did not complete. Please try again.' });
  return target.attachmentId;
}

export function useAttachmentUploads(scope: 'me' | 'admin') {
  const [items, setItems] = useState<PendingUpload[]>([]);

  const add = useCallback(
    (files: File[]) => {
      const room = LIMITS.attachments.maxFiles - items.length;
      for (const file of files.slice(0, Math.max(0, room))) {
        const key = `${file.name}-${file.size}-${crypto.randomUUID()}`;
        setItems((prev) => [...prev, { key, file, status: 'uploading' }]);
        upload(file, scope)
          .then((attachmentId) =>
            setItems((prev) => prev.map((i) => (i.key === key ? { ...i, status: 'done', attachmentId } : i))),
          )
          .catch((error: unknown) =>
            setItems((prev) =>
              prev.map((i) =>
                i.key === key
                  ? {
                      ...i,
                      status: 'error',
                      error: error instanceof ApiError ? error.message : 'Upload failed.',
                    }
                  : i,
              ),
            ),
          );
      }
    },
    [items.length, scope],
  );

  return {
    items,
    add,
    remove: (key: string) => setItems((prev) => prev.filter((i) => i.key !== key)),
    reset: () => setItems([]),
    ids: items.filter((i) => i.status === 'done' && i.attachmentId).map((i) => i.attachmentId!),
    busy: items.some((i) => i.status === 'uploading'),
  };
}

const ACCEPT = { 'image/jpeg': [], 'image/png': [], 'image/webp': [], 'application/pdf': [] };

export function AttachmentPicker({
  uploads,
  compact = false,
}: {
  uploads: ReturnType<typeof useAttachmentUploads>;
  compact?: boolean;
}) {
  const [rejection, setRejection] = useState<string | null>(null);
  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setRejection(
        rejected.length > 0
          ? rejected[0]?.errors[0]?.code === 'file-too-large'
            ? `Files can be at most ${LIMITS.attachments.maxBytes / 1024 / 1024} MB.`
            : 'Only JPG, PNG, WebP images or PDF files.'
          : null,
      );
      uploads.add(accepted);
    },
    [uploads],
  );
  const full = uploads.items.length >= LIMITS.attachments.maxFiles;
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: LIMITS.attachments.maxBytes,
    disabled: full,
    noClick: false,
  });

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-input px-4 text-sm transition hover:border-foreground/30 hover:bg-muted/40',
          compact ? 'py-2.5' : 'py-4',
          isDragActive && 'border-leaf bg-leaf-soft/50',
          full && 'pointer-events-none opacity-50',
        )}
      >
        <input {...getInputProps()} aria-label="Attach files" />
        <Paperclip className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">
          {isDragActive ? (
            'Drop to attach'
          ) : (
            <>
              <span className="font-semibold text-foreground">Attach photos or PDFs</span>
              {!compact && ' (e.g. a photo of a misprint, a payment screenshot)'} · up to{' '}
              {LIMITS.attachments.maxFiles}, {LIMITS.attachments.maxBytes / 1024 / 1024} MB each
            </>
          )}
        </span>
      </div>
      {rejection && <p className="text-[13px] font-medium text-danger">{rejection}</p>}
      {uploads.items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {uploads.items.map((item) => (
            <li
              key={item.key}
              className={cn(
                'flex max-w-full items-center gap-2 rounded-lg border bg-card py-1.5 pl-2.5 pr-1.5 text-[13px]',
                item.status === 'error' && 'border-danger/40 bg-danger-soft/50',
              )}
            >
              {item.status === 'uploading' ? (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              ) : item.status === 'error' ? (
                <TriangleAlert className="size-4 text-danger" />
              ) : item.file.type.startsWith('image/') ? (
                <ImageIcon className="size-4 text-leaf" />
              ) : (
                <FileText className="size-4 text-leaf" />
              )}
              <span className="max-w-48 truncate font-medium">{item.file.name}</span>
              <span className="text-muted-foreground">
                {item.status === 'error' ? item.error : fileSize(item.file.size)}
              </span>
              <button
                type="button"
                onClick={() => uploads.remove(item.key)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${item.file.name}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <li key={a.id}>
          <a
            href={a.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] font-medium transition hover:border-input hover:bg-muted"
          >
            {a.mimeType.startsWith('image/') ? (
              <ImageIcon className="size-4 text-muted-foreground" />
            ) : (
              <FileText className="size-4 text-muted-foreground" />
            )}
            <span className="max-w-56 truncate">{a.fileName}</span>
            <span className="text-muted-foreground">{fileSize(a.sizeBytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
