import type { PrintPartner, ProductionStage, SalesPlatform } from '@bookleaf/contracts';
import { z } from 'zod';
import raw from '../data/bookleaf_sample_data.json' with { type: 'json' };
import { rupeesToMinor } from './money';
import { parseStageLabel } from './production';

/**
 * The BookLeaf sample dataset (10 authors, 18 books) exactly as provided, parsed, normalised and
 * checked. Used by the database seed and by the AI evaluation suite. Any inconsistency (unknown
 * status, ledger that doesn't add up) throws, so bad data can never be seeded silently.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const BookRow = z.object({
  book_id: z.string().min(1),
  title: z.string().min(1),
  isbn: z.string().min(1),
  genre: z.string().min(1),
  publication_date: isoDate.nullable(),
  status: z.string().min(1),
  mrp: z.number().nonnegative().nullable(),
  author_royalty_per_copy: z.number().nonnegative().nullable(),
  total_copies_sold: z.number().int().nonnegative(),
  total_royalty_earned: z.number().nonnegative(),
  royalty_paid: z.number().nonnegative(),
  royalty_pending: z.number().nonnegative(),
  last_royalty_payout_date: isoDate.nullable(),
  print_partner: z.string().nullable(),
  available_on: z.array(z.string()),
});

const AuthorRow = z.object({
  author_id: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  joined_date: isoDate,
  books: z.array(BookRow),
});

const DatasetSchema = z.object({ authors: z.array(AuthorRow).min(1) });

const PLATFORMS: Record<string, SalesPlatform> = {
  'amazon india': 'amazon_in',
  flipkart: 'flipkart',
  'amazon us': 'amazon_us',
  'amazon uk': 'amazon_uk',
  'bookleaf store': 'bookleaf_store',
};

const PARTNERS: Record<string, PrintPartner> = {
  'in-house': 'in_house',
  'repro india': 'repro_india',
  'epitome books': 'epitome_books',
};

export interface DatasetBook {
  externalId: string;
  title: string;
  isbn: string;
  genre: string;
  publicationDate: string | null;
  stage: ProductionStage;
  mrpMinor: number | null;
  royaltyPerCopyMinor: number | null;
  copiesSold: number;
  earnedMinor: number;
  paidMinor: number;
  pendingMinor: number;
  lastPayoutDate: string | null;
  printPartner: PrintPartner | null;
  platforms: SalesPlatform[];
}

export interface DatasetAuthor {
  externalId: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  joinedDate: string;
  books: DatasetBook[];
}

export class DatasetError extends Error {
  constructor(readonly issues: string[]) {
    super(`Sample dataset failed validation:\n- ${issues.join('\n- ')}`);
    this.name = 'DatasetError';
  }
}

export function parseDataset(input: unknown): DatasetAuthor[] {
  const parsed = DatasetSchema.parse(input);
  const issues: string[] = [];
  const seenIsbn = new Set<string>();

  const authors = parsed.authors.map((author) => ({
    externalId: author.author_id,
    name: author.name,
    email: author.email.toLowerCase(),
    phone: author.phone,
    city: author.city,
    joinedDate: author.joined_date,
    books: author.books.map((book): DatasetBook => {
      const where = `${book.book_id} (${book.title})`;
      let stage: ProductionStage = 'manuscript_received';
      try {
        stage = parseStageLabel(book.status);
      } catch (error) {
        issues.push(`${where}: ${(error as Error).message}`);
      }
      const earned = rupeesToMinor(book.total_royalty_earned);
      const paid = rupeesToMinor(book.royalty_paid);
      const pending = rupeesToMinor(book.royalty_pending);
      const perCopy =
        book.author_royalty_per_copy === null ? null : rupeesToMinor(book.author_royalty_per_copy);

      if (pending !== earned - paid) issues.push(`${where}: pending ≠ earned − paid`);
      if (paid > earned) issues.push(`${where}: paid exceeds earned`);
      if (perCopy !== null && earned !== book.total_copies_sold * perCopy) {
        issues.push(`${where}: earned ≠ copies sold × royalty per copy`);
      }
      if (stage === 'published_live' && (book.publication_date === null || book.mrp === null)) {
        issues.push(`${where}: published book is missing publication date or MRP`);
      }
      if (stage !== 'published_live' && book.total_copies_sold > 0)
        issues.push(`${where}: sales on an unpublished book`);
      if (seenIsbn.has(book.isbn)) issues.push(`${where}: duplicate ISBN ${book.isbn}`);
      seenIsbn.add(book.isbn);

      const platforms = book.available_on.map((label) => {
        const platform = PLATFORMS[label.trim().toLowerCase()];
        if (!platform) issues.push(`${where}: unknown platform "${label}"`);
        return platform;
      });
      let printPartner: PrintPartner | null = null;
      if (book.print_partner) {
        printPartner = PARTNERS[book.print_partner.trim().toLowerCase()] ?? null;
        if (!printPartner) issues.push(`${where}: unknown print partner "${book.print_partner}"`);
      }

      return {
        externalId: book.book_id,
        title: book.title,
        isbn: book.isbn,
        genre: book.genre,
        publicationDate: book.publication_date,
        stage,
        mrpMinor: book.mrp === null ? null : rupeesToMinor(book.mrp),
        royaltyPerCopyMinor: perCopy,
        copiesSold: book.total_copies_sold,
        earnedMinor: earned,
        paidMinor: paid,
        pendingMinor: pending,
        lastPayoutDate: book.last_royalty_payout_date,
        printPartner,
        platforms: platforms.filter((p): p is SalesPlatform => Boolean(p)),
      };
    }),
  }));

  if (issues.length > 0) throw new DatasetError(issues);
  return authors;
}

let cached: DatasetAuthor[] | null = null;

export function loadSampleDataset(): DatasetAuthor[] {
  cached ??= parseDataset(raw);
  return cached;
}
