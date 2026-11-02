/**
 * RetryPolicy
 *
 * Classifies errors as retryable or permanent and computes next-attempt
 * timestamps using exponential backoff with full jitter.
 *
 * This module has zero React Native dependencies and is fully unit-testable.
 */

export type ErrorClassification = 'retryable' | 'permanent';

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// ─── Classification ───────────────────────────────────────────────────────────

export function classifyError(error: unknown): ErrorClassification {
  if (!(error instanceof Error)) return 'retryable';

  const status: number | undefined = (error as any).httpStatus;

  if (status !== undefined) {
    // Permanent: client errors that won't change on retry
    if (status === 400 || status === 413 || status === 401 || status === 403 || status === 404) {
      return 'permanent';
    }
    // Retryable: server errors, timeouts, rate limits
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
      return 'retryable';
    }
    // Any other 4xx is permanent
    if (status >= 400 && status < 500) {
      return 'permanent';
    }
  }

  // Network / connection errors — always retryable
  const message = error.message.toLowerCase();
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('failed to fetch') ||
    message.includes('network request failed')
  ) {
    return 'retryable';
  }

  // Unknown — default to retryable (we'd rather retry than silently drop)
  return 'retryable';
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

/**
 * Returns the ISO-8601 timestamp for the next retry attempt, or null if
 * the maximum number of attempts has been reached.
 */
export function nextRetryAt(attempts: number, error?: unknown): string | null {
  if (attempts >= MAX_ATTEMPTS) return null;

  // Check for Retry-After header value embedded in error message
  if (error instanceof Error) {
    const match = error.message.match(/retry-after:\s*(\d+)/i);
    if (match) {
      const retryAfterMs = parseInt(match[1], 10) * 1000;
      return new Date(Date.now() + retryAfterMs).toISOString();
    }
  }

  // Exponential backoff: BASE * 2^attempt, capped, with full jitter
  const exp = Math.min(BASE_DELAY_MS * Math.pow(2, attempts), MAX_DELAY_MS);
  const jitter = Math.random() * exp;
  const delayMs = Math.floor(jitter);

  return new Date(Date.now() + delayMs).toISOString();
}

export function hasExceededMaxAttempts(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

export { MAX_ATTEMPTS };
