/**
 * RetryPolicy unit tests
 *
 * Pure logic — no native modules, no network.
 */

import {
  classifyError,
  nextRetryAt,
  hasExceededMaxAttempts,
  MAX_ATTEMPTS,
} from '../../src/features/uploads/RetryPolicy';

// ─── classifyError ────────────────────────────────────────────────────────────

describe('classifyError', () => {
  test('classifies HTTP 400 as permanent', () => {
    const err = Object.assign(new Error('Bad request'), { httpStatus: 400 });
    expect(classifyError(err)).toBe('permanent');
  });

  test('classifies HTTP 413 as permanent', () => {
    const err = Object.assign(new Error('Too large'), { httpStatus: 413 });
    expect(classifyError(err)).toBe('permanent');
  });

  test('classifies HTTP 404 as permanent', () => {
    const err = Object.assign(new Error('Not found'), { httpStatus: 404 });
    expect(classifyError(err)).toBe('permanent');
  });

  test('classifies HTTP 500 as retryable', () => {
    const err = Object.assign(new Error('Server error'), { httpStatus: 500 });
    expect(classifyError(err)).toBe('retryable');
  });

  test('classifies HTTP 503 as retryable', () => {
    const err = Object.assign(new Error('Unavailable'), { httpStatus: 503 });
    expect(classifyError(err)).toBe('retryable');
  });

  test('classifies HTTP 429 as retryable', () => {
    const err = Object.assign(new Error('Rate limited'), { httpStatus: 429 });
    expect(classifyError(err)).toBe('retryable');
  });

  test('classifies HTTP 408 as retryable', () => {
    const err = Object.assign(new Error('Timeout'), { httpStatus: 408 });
    expect(classifyError(err)).toBe('retryable');
  });

  test('classifies network error as retryable', () => {
    const err = new Error('Network request failed');
    expect(classifyError(err)).toBe('retryable');
  });

  test('classifies timeout message as retryable', () => {
    const err = new Error('Request timeout after 30s');
    expect(classifyError(err)).toBe('retryable');
  });

  test('classifies unknown error as retryable', () => {
    expect(classifyError(new Error('something unexpected'))).toBe('retryable');
  });

  test('classifies non-Error as retryable', () => {
    expect(classifyError('string error')).toBe('retryable');
    expect(classifyError(null)).toBe('retryable');
  });
});

// ─── nextRetryAt ─────────────────────────────────────────────────────────────

describe('nextRetryAt', () => {
  test('returns a future ISO timestamp for attempt 0', () => {
    const before = Date.now();
    const result = nextRetryAt(0);
    expect(result).not.toBeNull();
    expect(new Date(result!).getTime()).toBeGreaterThanOrEqual(before);
  });

  test('returns null when max attempts reached', () => {
    expect(nextRetryAt(MAX_ATTEMPTS)).toBeNull();
    expect(nextRetryAt(MAX_ATTEMPTS + 1)).toBeNull();
  });

  test('respects Retry-After header in error message', () => {
    const before = Date.now();
    const err = new Error('[register-image] HTTP 429: Retry-After: 60');
    const result = nextRetryAt(1, err);
    expect(result).not.toBeNull();
    const delta = new Date(result!).getTime() - before;
    // Should be approximately 60 000 ms
    expect(delta).toBeGreaterThanOrEqual(55_000);
    expect(delta).toBeLessThanOrEqual(65_000);
  });

  test('later attempts produce longer delays on average', () => {
    // Run 50 samples at each attempt level; median of attempt 3 > median of attempt 0
    const samples = (attempt: number) =>
      Array.from({ length: 50 }, () => {
        const before = Date.now();
        const r = nextRetryAt(attempt);
        return r ? new Date(r).getTime() - before : 0;
      });

    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };

    const m0 = median(samples(0));
    const m3 = median(samples(3));
    // With full jitter this is probabilistic but should hold for 50 samples
    expect(m3).toBeGreaterThan(m0);
  });
});

// ─── hasExceededMaxAttempts ───────────────────────────────────────────────────

describe('hasExceededMaxAttempts', () => {
  test('returns false below limit', () => {
    expect(hasExceededMaxAttempts(0)).toBe(false);
    expect(hasExceededMaxAttempts(MAX_ATTEMPTS - 1)).toBe(false);
  });

  test('returns true at and above limit', () => {
    expect(hasExceededMaxAttempts(MAX_ATTEMPTS)).toBe(true);
    expect(hasExceededMaxAttempts(MAX_ATTEMPTS + 5)).toBe(true);
  });
});
