/**
 * Database service layer — all D1 queries encapsulated here.
 * No raw SQL in handlers.
 *
 * Each function receives a D1Database instance explicitly
 * rather than relying on module-level state.
 */

import { nowUTC } from "../utils/time";

// ─── Types ────────────────────────────────────────────────────────

export interface User {
  id: number;
  hourly_rate: number;
  payment_address: string;
}

export interface WorkSession {
  id: number;
  user_id: number;
  chat_id: number;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  invoiced: number;
}

export interface UninvoicedSession {
  id: number;
  user_id: number;
  chat_id: number;
  start_time: string;
  end_time: string;
  duration: number;
}

export interface Invoice {
  id: number;
  user_id: number;
  total_amount: number;
  paid_amount: number;
  created_at: string;
}

export interface Payment {
  id: number;
  user_id: number;
  amount: number;
  created_at: string;
}

// ─── User Operations ──────────────────────────────────────────────

export async function upsertUser(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare(`INSERT INTO users (id) VALUES (?) ON CONFLICT(id) DO NOTHING`)
    .bind(userId)
    .run();
}

export async function getUser(
  db: D1Database,
  userId: number
): Promise<User | null> {
  const result = await db
    .prepare(`SELECT id, hourly_rate, payment_address FROM users WHERE id = ?`)
    .bind(userId)
    .first<User>();
  return result ?? null;
}

export async function setHourlyRate(
  db: D1Database,
  userId: number,
  rate: number
): Promise<void> {
  await db
    .prepare(`UPDATE users SET hourly_rate = ? WHERE id = ?`)
    .bind(rate, userId)
    .run();
}

export async function setPaymentAddress(
  db: D1Database,
  userId: number,
  address: string
): Promise<void> {
  await db
    .prepare(`UPDATE users SET payment_address = ? WHERE id = ?`)
    .bind(address, userId)
    .run();
}

// ─── Work Session Operations ──────────────────────────────────────

export async function getActiveSession(
  db: D1Database,
  userId: number,
  chatId: number
): Promise<{ id: number; start_time: string } | null> {
  const result = await db
    .prepare(
      `SELECT id, start_time FROM work_sessions
       WHERE user_id = ? AND chat_id = ? AND end_time IS NULL
       LIMIT 1`
    )
    .bind(userId, chatId)
    .first<{ id: number; start_time: string }>();
  return result ?? null;
}

/**
 * Starts a work session using INSERT ... RETURNING.
 * The UNIQUE partial index (idx_active_session) on work_sessions prevents
 * duplicate active sessions at the DB level even under concurrent writes.
 */
export async function startWorkSession(
  db: D1Database,
  userId: number,
  chatId: number
): Promise<{ id: number; start_time: string }> {
  const startTime = nowUTC();
  const result = await db
    .prepare(
      `INSERT INTO work_sessions (user_id, chat_id, start_time)
       VALUES (?, ?, ?)
       RETURNING id, start_time`
    )
    .bind(userId, chatId, startTime)
    .first<{ id: number; start_time: string }>();

  if (!result) {
    throw new Error("Failed to create work session");
  }
  return result;
}

export async function endWorkSession(
  db: D1Database,
  sessionId: number,
  endTime: string,
  duration: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE work_sessions SET end_time = ?, duration = ? WHERE id = ?`
    )
    .bind(endTime, duration, sessionId)
    .run();
}

// ─── Invoice Operations ───────────────────────────────────────────

export async function getUninvoicedSessions(
  db: D1Database,
  userId: number
): Promise<UninvoicedSession[]> {
  const result = await db
    .prepare(
      `SELECT id, user_id, chat_id, start_time, end_time, duration
       FROM work_sessions
       WHERE user_id = ? AND invoiced = 0 AND end_time IS NOT NULL`
    )
    .bind(userId)
    .all<UninvoicedSession>();
  return result.results ?? [];
}

export async function createInvoice(
  db: D1Database,
  userId: number,
  totalAmount: number
): Promise<{ id: number }> {
  const createdAt = nowUTC();
  const result = await db
    .prepare(
      `INSERT INTO invoices (user_id, total_amount, created_at)
       VALUES (?, ?, ?)
       RETURNING id`
    )
    .bind(userId, totalAmount, createdAt)
    .first<{ id: number }>();

  if (!result) {
    throw new Error("Failed to create invoice");
  }
  return result;
}

export async function markSessionsInvoiced(
  db: D1Database,
  sessionIds: number[]
): Promise<void> {
  if (sessionIds.length === 0) return;

  // D1 doesn't support array bindings, so we batch individual updates
  const stmt = db.prepare(`UPDATE work_sessions SET invoiced = 1 WHERE id = ?`);
  await db.batch(sessionIds.map((id) => stmt.bind(id)));
}

// ─── Payment Operations ──────────────────────────────────────────

export async function recordPayment(
  db: D1Database,
  userId: number,
  amount: number
): Promise<{ id: number }> {
  const createdAt = nowUTC();
  const result = await db
    .prepare(
      `INSERT INTO payments (user_id, amount, created_at)
       VALUES (?, ?, ?)
       RETURNING id`
    )
    .bind(userId, amount, createdAt)
    .first<{ id: number }>();

  if (!result) {
    throw new Error("Failed to record payment");
  }
  return result;
}

export async function getLatestInvoice(
  db: D1Database,
  userId: number
): Promise<Invoice | null> {
  const result = await db
    .prepare(
      `SELECT id, total_amount, paid_amount, created_at
       FROM invoices
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(userId)
    .first<Invoice>();
  return result ?? null;
}

export async function updateInvoicePaidAmount(
  db: D1Database,
  invoiceId: number,
  newPaidAmount: number
): Promise<void> {
  await db
    .prepare(`UPDATE invoices SET paid_amount = ? WHERE id = ?`)
    .bind(newPaidAmount, invoiceId)
    .run();
}

export async function getTotalPayments(
  db: D1Database,
  userId: number
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ total: number }>();
  return result?.total ?? 0;
}

export async function getTotalInvoiced(
  db: D1Database,
  userId: number
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM invoices WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ total: number }>();
  return result?.total ?? 0;
}
