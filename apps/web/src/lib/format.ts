import type { Money, SlaView } from '@bookleaf/contracts';
import { formatInr } from '@bookleaf/domain';
import { differenceInCalendarDays, format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';

export function money(value: Money | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return formatInr(typeof value === 'number' ? value : value.amountMinor);
}

export function count(value: number): string {
  return value.toLocaleString('en-IN');
}

/** "15 October 2025" */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso), 'd MMMM yyyy');
}

/** "15 Oct 2025" */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso), 'd MMM yyyy');
}

/** "Today, 3:42 pm" · "Yesterday, 9:10 am" · "12 Oct, 4:05 pm" */
export function stamp(iso: string): string {
  const date = new Date(iso);
  const time = format(date, 'h:mm a').toLowerCase();
  if (isToday(date)) return `Today, ${time}`;
  if (isYesterday(date)) return `Yesterday, ${time}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `${format(date, sameYear ? 'd MMM' : 'd MMM yyyy')}, ${time}`;
}

/** "3 hours ago" */
export function ago(iso: string): string {
  return `${formatDistanceToNowStrict(new Date(iso))} ago`;
}

/** "3h" style compact age for dense lists. */
export function compactAge(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function daysUntil(iso: string): number {
  return differenceInCalendarDays(new Date(`${iso}T00:00:00`), new Date());
}

function duration(minutes: number): string {
  const m = Math.abs(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 >= 30 && h < 10 ? `${h}.5h` : `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export interface SlaDisplay {
  label: string;
  tone: 'critical' | 'warning' | 'success' | 'neutral' | 'leaf';
}

export function slaDisplay(sla: SlaView): SlaDisplay {
  const remaining = sla.minutesRemaining;
  switch (sla.state) {
    case 'breached':
      return { label: remaining === null ? 'Overdue' : `Overdue ${duration(remaining)}`, tone: 'critical' };
    case 'at_risk':
      return { label: remaining === null ? 'Due soon' : `Due in ${duration(remaining)}`, tone: 'warning' };
    case 'on_track':
      return { label: remaining === null ? 'On track' : `Due in ${duration(remaining)}`, tone: 'neutral' };
    case 'met':
      return { label: 'Answered in time', tone: 'success' };
    case 'paused':
      return { label: 'Waiting on author', tone: 'neutral' };
    default:
      return { label: 'Leaf is triaging', tone: 'leaf' };
  }
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
