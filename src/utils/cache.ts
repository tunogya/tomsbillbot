/**
 * KV-based cache for hot data.
 *
 * Caches frequently-read D1 data (customer info, unit rates, granularity) in KV
 * with a short TTL. Helpers for explicit invalidation on writes.
 *
 * Cache keys:
 *   customer:{id}                    → Customer JSON
 *   rate:{customerId}:{chatId}       → unit_amount string
 *   granularity:{customerId}:{chatId} → granularity_minutes string
 */

import type { Customer } from "../services/db";

const CACHE_TTL = 300; // 5 minutes

// ─── Customer Cache ──────────────────────────────────────────────

export async function getCachedCustomer(
  kv: KVNamespace,
  db: D1Database,
  customerId: number
): Promise<Customer | null> {
  const key = `customer:${customerId}`;

  // Try cache first
  const cached = await kv.get(key, "json");
  if (cached) return cached as Customer;

  // Fall back to D1
  const result = await db
    .prepare(`SELECT * FROM customers WHERE id = ?`)
    .bind(customerId)
    .first<Customer>();

  if (result) {
    await kv.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL });
  }

  return result ?? null;
}

export async function invalidateCustomerCache(
  kv: KVNamespace,
  customerId: number
): Promise<void> {
  await kv.delete(`customer:${customerId}`);
}

// ─── Unit Amount (Rate) Cache ────────────────────────────────────

export async function getCachedUnitAmount(
  kv: KVNamespace,
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<number> {
  const key = `rate:${customerId}:${chatId}`;

  // Try cache first
  const cached = await kv.get(key);
  if (cached !== null) return parseInt(cached, 10);

  // Fall back to D1 (uses the optimized COALESCE query)
  const result = await db
    .prepare(
      `SELECT COALESCE(
        (SELECT unit_amount FROM prices WHERE customer_id = ?1 AND chat_id = ?2),
        (SELECT unit_amount FROM prices WHERE customer_id = ?1 AND chat_id = 0),
        0
      ) AS unit_amount`
    )
    .bind(customerId, chatId)
    .first<{ unit_amount: number }>();

  const rate = result?.unit_amount ?? 0;
  await kv.put(key, String(rate), { expirationTtl: CACHE_TTL });
  return rate;
}

export async function invalidateRateCache(
  kv: KVNamespace,
  customerId: number,
  chatId: number
): Promise<void> {
  await kv.delete(`rate:${customerId}:${chatId}`);
  // Also invalidate global default cache since it may have changed
  if (chatId !== 0) {
    await kv.delete(`rate:${customerId}:0`);
  }
}

// ─── Granularity Cache ───────────────────────────────────────────

export async function getCachedGranularity(
  kv: KVNamespace,
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<number> {
  const key = `granularity:${customerId}:${chatId}`;

  // Try cache first
  const cached = await kv.get(key);
  if (cached !== null) return parseInt(cached, 10);

  // Fall back to D1 (uses the COALESCE fallback query in getGranularity)
  const { getGranularity } = await import("../services/db");
  const value = await getGranularity(db, customerId, chatId);
  await kv.put(key, String(value), { expirationTtl: CACHE_TTL });
  return value;
}

export async function invalidateGranularityCache(
  kv: KVNamespace,
  customerId: number,
  chatId: number
): Promise<void> {
  await kv.delete(`granularity:${customerId}:${chatId}`);
  if (chatId !== 0) {
    await kv.delete(`granularity:${customerId}:0`);
  }
}
