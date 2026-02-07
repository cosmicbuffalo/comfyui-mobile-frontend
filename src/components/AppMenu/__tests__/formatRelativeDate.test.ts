import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeDate } from '../UserWorkflowsPanel';

// Pin "now" so tests are deterministic
const NOW = new Date('2025-03-15T12:00:00Z');

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function daysAgo(days: number): number {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return toUnixSeconds(d);
}

describe('formatRelativeDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function withFakeNow(fn: () => void) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fn();
  }

  it('returns "mm/dd/yy (Today)" for timestamps from the same day', () => {
    withFakeNow(() => {
      expect(formatRelativeDate(daysAgo(0))).toBe('3/15/25 (Today)');
    });
  });

  it('returns "mm/dd/yy (Yesterday)" for timestamps from 1 day ago', () => {
    withFakeNow(() => {
      expect(formatRelativeDate(daysAgo(1))).toBe('3/14/25 (Yesterday)');
    });
  });

  it('returns "mm/dd/yy (X days ago)" for 2 days ago', () => {
    withFakeNow(() => {
      expect(formatRelativeDate(daysAgo(2))).toBe('3/13/25 (2 days ago)');
    });
  });

  it('returns "mm/dd/yy (X days ago)" for 30 days ago', () => {
    withFakeNow(() => {
      // daysAgo subtracts calendar days, so the date is Feb 13
      const result = formatRelativeDate(daysAgo(30));
      expect(result).toMatch(/^2\/13\/25 \(\d+ days ago\)$/);
    });
  });

  it('returns "mm/dd/yy (X days ago)" for very old timestamps', () => {
    withFakeNow(() => {
      expect(formatRelativeDate(daysAgo(365))).toBe('3/15/24 (365 days ago)');
    });
  });

  it('does not zero-pad single-digit months and days', () => {
    withFakeNow(() => {
      // Jan 5 2025 = 69 days before March 15
      const jan5 = toUnixSeconds(new Date('2025-01-05T12:00:00Z'));
      expect(formatRelativeDate(jan5)).toBe('1/5/25 (69 days ago)');
    });
  });
});
