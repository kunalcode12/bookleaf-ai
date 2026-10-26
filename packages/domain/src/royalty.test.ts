import { describe, expect, it } from 'vitest';
import { parseIsoDate, toIsoDate } from './dates';
import { formatInr } from './money';
import { computePayout, nextPayoutWindow, summarizePortfolio } from './royalty';

const today = parseIsoDate('2026-10-26');

describe('nextPayoutWindow', () => {
  it('uses the last completed quarter while its 45-day window is still open', () => {
    const w = nextPayoutWindow(today);
    expect(toIsoDate(w.quarterEnd)).toBe('2026-09-30');
    expect(toIsoDate(w.deadline)).toBe('2026-11-14');
    expect(w.periodLabel).toBe('Jul–Sep 2026');
  });

  it('rolls to the running quarter once that window has closed', () => {
    const w = nextPayoutWindow(parseIsoDate('2026-11-20'));
    expect(toIsoDate(w.deadline)).toBe('2027-02-14');
    expect(w.periodLabel).toBe('Oct–Dec 2026');
  });

  it('treats the deadline day itself as still open', () => {
    expect(toIsoDate(nextPayoutWindow(parseIsoDate('2026-11-14')).deadline)).toBe('2026-11-14');
  });
});

describe('computePayout — dataset edge cases', () => {
  it('BK001 Whispers of the Ganges: balance above minimum, 3 windows closed since 15 Oct 2025', () => {
    const p = computePayout(
      {
        stage: 'published_live',
        publicationDate: '2023-06-20',
        earnedMinor: 1_197_000,
        paidMinor: 840_000,
        pendingMinor: 357_000,
        lastPayoutDate: '2025-10-15',
      },
      today,
    );
    expect(p.status).toBe('attention');
    expect(p.missedWindows).toBe(3);
    expect(p.missedWindowDates).toEqual(['2026-02-14', '2026-05-15', '2026-08-14']);
    expect(p.nextPayoutDate).toBe('2026-11-14');
    expect(p.message).toContain('₹3,570');
  });

  it('BK016 The Nagpur Notebooks: ₹850 never paid is below the ₹1,000 minimum, not overdue', () => {
    const p = computePayout(
      {
        stage: 'published_live',
        publicationDate: '2024-11-05',
        earnedMinor: 85_000,
        paidMinor: 0,
        pendingMinor: 85_000,
        lastPayoutDate: null,
      },
      today,
    );
    expect(p.status).toBe('below_threshold');
    expect(p.belowThreshold).toBe(true);
    expect(p.missedWindows).toBe(0);
    expect(p.message).toMatch(/below the ₹1,000 minimum/);
  });

  it('BK005 Between Two Temples: never paid since publication in Jul 2024', () => {
    const p = computePayout(
      {
        stage: 'published_live',
        publicationDate: '2024-07-05',
        earnedMinor: 254_600,
        paidMinor: 0,
        pendingMinor: 254_600,
        lastPayoutDate: null,
      },
      today,
    );
    expect(p.status).toBe('attention');
    expect(p.missedWindows).toBe(8);
    expect(p.message).toContain('since publication');
  });

  it('BK002 The Saffron Diaries: fully paid', () => {
    const p = computePayout(
      {
        stage: 'published_live',
        publicationDate: '2024-01-10',
        earnedMinor: 793_800,
        paidMinor: 793_800,
        pendingMinor: 0,
        lastPayoutDate: '2025-12-01',
      },
      today,
    );
    expect(p.status).toBe('settled');
    expect(p.message).toContain('1 December 2025');
  });

  it('BK013 Midnight in Mysore: in production, no royalty logic applies', () => {
    const p = computePayout(
      {
        stage: 'cover_design',
        publicationDate: null,
        earnedMinor: 0,
        paidMinor: 0,
        pendingMinor: 0,
        lastPayoutDate: null,
      },
      today,
    );
    expect(p.status).toBe('not_applicable');
    expect(p.nextPayoutDate).toBeNull();
  });

  it('is "scheduled" when the balance accrued after the last payout and no window has closed yet', () => {
    const p = computePayout(
      {
        stage: 'published_live',
        publicationDate: '2024-01-01',
        earnedMinor: 500_000,
        paidMinor: 300_000,
        pendingMinor: 200_000,
        lastPayoutDate: '2026-08-10',
      },
      today,
    );
    expect(p.status).toBe('scheduled');
    expect(p.message).toContain('14 November 2026');
  });
});

describe('summarizePortfolio', () => {
  it('aggregates an author with a live and an in-production book (Kavita Deshmukh)', () => {
    const s = summarizePortfolio(
      [
        {
          stage: 'typesetting',
          publicationDate: null,
          earnedMinor: 0,
          paidMinor: 0,
          pendingMinor: 0,
          lastPayoutDate: null,
          copiesSold: 0,
        },
        {
          stage: 'published_live',
          publicationDate: '2024-11-05',
          earnedMinor: 85_000,
          paidMinor: 0,
          pendingMinor: 85_000,
          lastPayoutDate: null,
          copiesSold: 34,
        },
      ],
      today,
    );
    expect(s).toMatchObject({
      totalBooks: 2,
      liveBooks: 1,
      inProductionBooks: 1,
      copiesSold: 34,
      pendingMinor: 85_000,
    });
    expect(s.booksNeedingAttention).toBe(0);
    expect(formatInr(s.pendingMinor)).toBe('₹850');
  });
});
