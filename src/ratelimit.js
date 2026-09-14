// Tiny in-process token-bucket rate limiter (per key, default per-IP).
// Guards the open HTTP surface (pay links, onboarding, webhooks) against abuse
// without adding a dependency. Deterministic clock injectable for tests.
export class RateLimiter {
  /** @param {{ capacity?: number, refillPerSec?: number, now?: () => number }} opts */
  constructor({ capacity = 30, refillPerSec = 0.5, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.buckets = new Map();
  }

  /** Consume 1 token for `key`. Returns { allowed, remaining, retryAfterMs }. */
  take(key, cost = 1) {
    const k = String(key || 'anon');
    const t = this.now();
    let b = this.buckets.get(k);
    if (!b) { b = { tokens: this.capacity, ts: t }; this.buckets.set(k, b); }
    // refill
    const elapsed = Math.max(0, t - b.ts) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.ts = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
    }
    const need = cost - b.tokens;
    return { allowed: false, remaining: 0, retryAfterMs: Math.ceil((need / this.refillPerSec) * 1000) };
  }

  reset(key) { this.buckets.delete(String(key)); }
}
