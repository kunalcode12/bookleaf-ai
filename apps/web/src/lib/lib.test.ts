import { describe, expect, it } from 'vitest';
import { ApiError, qs } from './api/client';
import { money, slaDisplay } from './format';
import { initials, plural } from './utils';

describe('query strings', () => {
  it('skips empty values and joins lists', () => {
    expect(qs({ status: ['open', 'in_progress'], q: '', assignee: null, limit: 30, sort: undefined })).toBe(
      '?status=open%2Cin_progress&limit=30',
    );
    expect(qs({})).toBe('');
  });
});

describe('formatting', () => {
  it('formats paise as Indian rupees', () => {
    expect(money({ amountMinor: 357_000, currency: 'INR' })).toBe('₹3,570');
    expect(money(1_234_567_00)).toBe('₹12,34,567');
    expect(money(null)).toBe('—');
  });

  it('describes SLA state in plain words', () => {
    expect(slaDisplay({ state: 'breached', minutesRemaining: -125, dueAt: null, targetHours: 4 })).toEqual({
      label: 'Overdue 2h',
      tone: 'critical',
    });
    expect(slaDisplay({ state: 'at_risk', minutesRemaining: 45, dueAt: null, targetHours: 12 }).label).toBe(
      'Due in 45m',
    );
    expect(slaDisplay({ state: 'met', minutesRemaining: null, dueAt: null, targetHours: 24 }).tone).toBe(
      'success',
    );
  });

  it('builds initials and plurals', () => {
    expect(initials('Priya Sharma')).toBe('PS');
    expect(initials('Kabir')).toBe('K');
    expect(plural(1, 'question')).toBe('1 question');
    expect(plural(1200, 'ticket')).toBe('1,200 tickets');
  });
});

describe('API errors', () => {
  it('keeps the problem code, field errors and request id', () => {
    const error = new ApiError(422, {
      code: 'VALIDATION_FAILED',
      detail: 'Some fields need your attention.',
      errors: [{ path: 'subject', message: 'Subject needs at least 5 characters' }],
      requestId: 'req-123',
    });
    expect(error.fieldError('subject')).toBe('Subject needs at least 5 characters');
    expect(error.requestId).toBe('req-123');
    expect(error.retryable).toBe(false);
    expect(ApiError.network().retryable).toBe(true);
  });
});
