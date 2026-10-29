'use client';

import type { Attachment, TicketMessage } from '@bookleaf/contracts';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { stamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AttachmentList } from './attachments';
import { BookLeafMark } from './brand';
import { Avatar } from './ui/misc';

/**
 * A conversation rendered as correspondence: the author's notes on plain paper, BookLeaf's replies
 * on letterhead. `viewer` decides which side is "you".
 */
export function Letter({
  sender,
  name,
  title,
  body,
  at,
  attachments = [],
  viewer,
  label,
  footer,
  highlight,
}: {
  sender: TicketMessage['sender'];
  name: string;
  title?: string | null;
  body: string;
  at: string;
  attachments?: Attachment[];
  viewer: 'author' | 'admin';
  label?: ReactNode;
  footer?: ReactNode;
  highlight?: boolean;
}) {
  const fromBookLeaf = sender === 'admin';
  const mine = (viewer === 'author' && sender === 'author') || (viewer === 'admin' && fromBookLeaf);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'relative rounded-2xl border p-5 sm:p-6',
        fromBookLeaf
          ? 'border-border bg-card shadow-page'
          : 'border-dashed border-input bg-background-deep/40',
        mine && viewer === 'admin' && 'ml-0 sm:ml-10',
        !mine && viewer === 'admin' && 'mr-0 sm:mr-10',
        highlight && 'ring-2 ring-accent/50',
      )}
    >
      {fromBookLeaf && (
        <div className="absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-gradient-to-r from-accent via-accent/60 to-transparent" />
      )}
      <header className="mb-4 flex items-center gap-3">
        {fromBookLeaf ? <BookLeafMark className="size-9" /> : <Avatar name={name} />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">
            {name}
            {label && <span className="ml-2 align-middle">{label}</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {fromBookLeaf ? (title ?? 'BookLeaf Author Support') : 'Author'}
          </p>
        </div>
        <time dateTime={at} className="shrink-0 text-xs text-muted-foreground">
          {stamp(at)}
        </time>
      </header>
      <div className="whitespace-pre-line text-[15px] leading-[1.7]">{body}</div>
      <AttachmentList attachments={attachments} />
      {footer && <div className="mt-4 border-t border-dashed pt-3">{footer}</div>}
    </motion.article>
  );
}
