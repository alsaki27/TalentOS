// src/lib/rateLimit.ts
// Simple in-memory rate limiter using a Map with TTL.
// NOTE: In a serverless/edge deployment, in-memory state is NOT shared across
// instances. For production, rate-limiting should be configured at the
// Cloudflare Reverse Proxy level (WAF rate-limiting rules) or via a
// distributed store (e.g. Redis). This implementation provides a basic
// guardrail for development and single-instance environments.

type BucketKey = string;

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<BucketKey, Bucket>();

function cleanupExpired() {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (now >= bucket.resetAt) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Checks whether the given key has exceeded the rate limit.
 * Returns the result and updates the counter atomically.
 *
 * @param key   Unique identifier for the rate limit bucket (e.g. `test:<keyId>`)
 * @param config  Max requests and time window
 */
export function checkRateLimit(
  key: BucketKey,
  config: RateLimitConfig,
): RateLimitResult {
  cleanupExpired();

  const now = Date.now();
  const existing = store.get(key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  if (existing.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: config.maxRequests - existing.count, resetAt: existing.resetAt };
}
