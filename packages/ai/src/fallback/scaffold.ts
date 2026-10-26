import type { TicketCategory } from '@bookleaf/contracts';
import { computePayout, describeStage, formatInr } from '@bookleaf/domain';
import type { TicketInput } from '../types';

/**
 * Deterministic reply outline used when no AI provider is available. It is built from the same
 * records and policies Leaf would use, so the admin starts from accurate facts and BookLeaf's
 * standard timelines. Parts that need human judgement are `[[placeholders]]`, which the editor
 * blocks from being sent until they are replaced.
 */
export function scaffoldReply(input: {
  ticket: TicketInput;
  category: TicketCategory;
  signature: string;
  today: Date;
}): string {
  const { ticket, category } = input;
  const firstName = ticket.author.name.split(/\s+/)[0] ?? ticket.author.name;
  const book = ticket.book;
  const title = book ? `"${book.title}"` : 'your account';

  const paragraphs: string[] = [`Hi ${firstName},`];

  switch (category) {
    case 'royalty_payments': {
      paragraphs.push(
        `Thank you for writing to us about the royalties for ${title}. [[Acknowledge the author's specific concern in one sentence.]]`,
      );
      if (book && book.stage === 'published_live') {
        const payout = computePayout(
          {
            stage: book.stage,
            publicationDate: book.publicationDate,
            earnedMinor: book.earnedMinor,
            paidMinor: book.paidMinor,
            pendingMinor: book.pendingMinor,
            lastPayoutDate: book.lastPayoutDate,
          },
          input.today,
        );
        paragraphs.push(
          `Our records show ${book.copiesSold} copies sold, ${formatInr(book.earnedMinor)} earned, ${formatInr(book.paidMinor)} paid out and ${formatInr(book.pendingMinor)} pending. ${payout.message} Royalties are calculated quarterly and paid within 45 days of the quarter ending, by bank transfer to the account linked in your dashboard.`,
        );
      } else {
        paragraphs.push(
          'Royalties are calculated quarterly and paid within 45 days of the quarter ending, by bank transfer to the account linked in your dashboard. Balances below ₹1,000 roll over to the next quarter.',
        );
      }
      paragraphs.push(
        '[[If a payout is overdue: own it, confirm the escalation to our finance team and promise an update within 48 hours. Otherwise confirm the next payout date.]]',
      );
      break;
    }
    case 'isbn_metadata':
      paragraphs.push(
        `Thank you for flagging this about ${title} — an ISBN or listing mismatch is a serious data issue, and we're treating it as a high priority.`,
        "I've escalated it to our production team, and we'll get back to you within 48 hours with the correction. [[Confirm the exact details the author reported.]]",
      );
      break;
    case 'printing_quality':
      paragraphs.push(
        `I'm truly sorry the printed copies of ${title} arrived like this. [[Name the specific defects the author described.]]`,
        "Could you share a few photos of the affected pages? Once we've verified the issue, BookLeaf will arrange a free reprint, which takes 5–7 business days.",
      );
      break;
    case 'distribution_availability':
      paragraphs.push(
        `Thank you for letting us know about the listing for ${title}. When a published book shows as unavailable, it is usually a stock sync issue.`,
        "I'm triggering a re-sync with our distribution team now; it typically takes 24–48 hours for the listing to go live again. [[Confirm which platform is affected.]]",
      );
      break;
    case 'book_status_production': {
      if (book && book.stage !== 'published_live') {
        const stage = describeStage(book.stage);
        paragraphs.push(
          `Thank you for checking in on ${title}. It is currently at ${stage.stageLabel} (step ${stage.stepNumber} of ${stage.totalSteps}). ${stage.stageDescription}`,
        );
      } else {
        paragraphs.push(`Thank you for checking in on ${title}. [[State the current production status.]]`);
      }
      paragraphs.push('[[Give the specific updated timeline once confirmed with the production team.]]');
      break;
    }
    default:
      paragraphs.push(
        'Thank you for getting in touch. [[Answer the question using the relevant BookLeaf policy, with any timelines it gives.]]',
      );
  }

  paragraphs.push('[[Close with one clear next step.]]');
  paragraphs.push(input.signature);
  return paragraphs.join('\n\n');
}
