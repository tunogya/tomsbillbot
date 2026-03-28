/**
 * Idempotency guard using Cloudflare KV.
 * Prevents duplicate processing of Telegram updates.
 */

const KEY_PREFIX = "update:";
const TTL_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * Checks if a Telegram update_id has already been processed.
 * Returns true if duplicate (should skip), false if new.
 */
export async function isDuplicate(
  kv: KVNamespace,
  updateId: number
): Promise<boolean> {
  const key = `${KEY_PREFIX}${updateId}`;
  const existing = await kv.get(key);
  return existing !== null;
}

/**
 * Marks a Telegram update_id as processed.
 * Stored with 24h TTL to auto-expire old entries.
 */
export async function markProcessed(
  kv: KVNamespace,
  updateId: number
): Promise<void> {
  const key = `${KEY_PREFIX}${updateId}`;
  await kv.put(key, "1", { expirationTtl: TTL_SECONDS });
}
