import { describe, expect, it } from 'vitest';
import { DatasetError, loadSampleDataset, parseDataset } from './dataset';

describe('sample dataset', () => {
  it('loads all 10 authors and 18 books exactly as provided', () => {
    const authors = loadSampleDataset();
    expect(authors).toHaveLength(10);
    expect(authors.flatMap((a) => a.books)).toHaveLength(18);
  });

  it('normalises statuses, money and platforms', () => {
    const books = loadSampleDataset().flatMap((a) => a.books);
    const bk001 = books.find((b) => b.externalId === 'BK001')!;
    expect(bk001).toMatchObject({
      stage: 'published_live',
      mrpMinor: 39_900,
      pendingMinor: 357_000,
      printPartner: 'in_house',
      platforms: ['amazon_in', 'flipkart', 'bookleaf_store'],
    });
    const inProduction = books
      .filter((b) => b.stage !== 'published_live')
      .map((b) => [b.externalId, b.stage]);
    expect(inProduction).toEqual([
      ['BK013', 'cover_design'],
      ['BK015', 'typesetting'],
    ]);
  });

  it('rejects a ledger that does not add up', () => {
    const bad = {
      authors: [
        {
          author_id: 'A',
          name: 'A',
          email: 'a@x.test',
          phone: null,
          city: null,
          joined_date: '2024-01-01',
          books: [
            {
              book_id: 'B',
              title: 'B',
              isbn: 'I',
              genre: 'G',
              publication_date: '2024-02-01',
              status: 'Published & Live',
              mrp: 100,
              author_royalty_per_copy: 10,
              total_copies_sold: 3,
              total_royalty_earned: 31,
              royalty_paid: 0,
              royalty_pending: 31,
              last_royalty_payout_date: null,
              print_partner: 'In-House',
              available_on: ['Amazon India'],
            },
          ],
        },
      ],
    };
    expect(() => parseDataset(bad)).toThrow(DatasetError);
  });
});
