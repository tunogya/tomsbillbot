/**
 * Rate limiting using Cloudflare KV.
 *
 * Simple per-minute window rate limiter.
 * Key format: ratelimit:{userId}:{minuteBucket}
 */

const DEFAULT_LIMIT = 20; // max commands per minute
const TTL_SECONDS = 120; // 2 minutes (covers current + next window)

/**
 * Check if a user has exceeded the rate limit.
 * Returns true if allowed, false if rate-limited.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  userId: number,
  limit: number = DEFAULT_LIMIT
): Promise<boolean> {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `ratelimit:${userId}:${minuteBucket}`;

  const current = parseInt(await kv.get(key) ?? "0", 10);
  if (current >= limit) return false;

  await kv.put(key, String(current + 1), { expirationTtl: TTL_SECONDS });
  return true;
}
