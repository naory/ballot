/**
 * Small, dependency-free security utilities shared by server code.
 *
 * Pure logic (no Node or browser APIs) so it lives in @ballot/core and can be
 * unit-tested with the rest of the package. Used by the app's poll-creation
 * endpoint to gate access and throttle abuse (F5).
 */

/**
 * Constant-time-ish string equality for secrets (API keys).
 *
 * Avoids the early-exit timing leak of `===`. Length is compared first, which
 * leaks only the length of the secret — acceptable for API keys. Returns false
 * for empty inputs.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * In-memory fixed-window rate limiter, keyed by an arbitrary string (e.g. IP).
 *
 * Suitable for a single server process (state is per-instance). `check` returns
 * true when the request is allowed and false when the key has exhausted its
 * budget for the current window. `now` is injectable for testing.
 */
export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string, now: number = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count < this.limit) {
      bucket.count += 1;
      return true;
    }
    return false;
  }
}
