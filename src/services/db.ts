/**
 * Database service layer - Stripe-inspired object model.
 *
 * All amounts are stored in cents (integer).
 * All timestamps are Unix seconds (integer).
 *
 * Object hierarchy:
 *   Customer → Price (per-group rate)
 *   Customer → WorkSession → Invoice (via invoice_id)
 *   Invoice  → InvoiceLineItem
 *   Invoice  → Payment (via invoice_id)
 *   All      → BalanceTransaction (unified ledger)
 */

import { nowTs, computeAmount } from "../utils/time";

// ─── Constants ────────────────────────────────────────────────────

export const SESSION_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed'
} as const;

export const INVOICE_STATUS = {
  DRAFT: 'draft',
  OPEN: 'open',
  PAID: 'paid',
  VOID: 'void'
} as const;

export const PAYMENT_STATUS = {
  SUCCEEDED: 'succeeded',
  REFUNDED: 'refunded'
} as const;

export const TRANSACTION_TYPE = {
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  ADJUSTMENT: 'adjustment'
} as const;

// ─── Types ────────────────────────────────────────────────────────

export interface Customer {
  id: number;
  name: string;
  payment_address: string;
  currency: string;
  metadata: string; // JSON string
  created: number;
  updated: number;
}

export interface Price {
  id: number;
  customer_id: number;
  chat_id: number;
  unit_amount: number; // cents per hour
  currency: string;
  metadata: string; // JSON string, e.g. {"granularity_minutes": 30}
  created: number;
}

export interface WorkSession {
  id: number;
  customer_id: number;
  chat_id: number;
  status: string; // 'active' | 'completed'
  start_time: number;
  end_time: number | null;
  duration_minutes: number | null;
  tag: string | null;
  invoice_id: number | null;
  created: number;
}

export interface Invoice {
  id: number;
  customer_id: number;
  chat_id: number;
  status: string; // 'draft' | 'open' | 'paid' | 'void'
  currency: string;
  subtotal: number; // cents
  total: number; // cents
  amount_paid: number; // cents
  amount_due: number; // cents
  description: string | null;
  metadata: string;
  period_start: number | null;
  period_end: number | null;
  created: number;
  finalized_at: number | null;
  paid_at: number | null;
  voided_at: number | null;
}

export interface InvoiceLineItem {
  id: number;
  invoice_id: number;
  description: string | null;
  quantity: number; // minutes
  unit_amount: number; // cents per hour
  amount: number; // cents
  work_session_id: number | null;
  created: number;
}

export interface Payment {
  id: number;
  customer_id: number;
  chat_id: number;
  invoice_id: number | null;
  amount: number; // cents
  currency: string;
  status: string; // 'succeeded' | 'refunded'
  description: string | null;
  metadata: string;
  created: number;
}

export interface Expense {
  id: number;
  customer_id: number;
  chat_id: number;
  amount: number; // cents
  currency: string;
  description: string | null;
  invoice_id: number | null;
  created: number;
}

export interface BalanceTransaction {
  id: number;
  customer_id: number;
  chat_id: number;
  type: string; // 'invoice' | 'payment' | 'adjustment'
  amount: number; // cents: positive = receivable, negative = received
  currency: string;
  description: string | null;
  source_type: string | null;
  source_id: number | null;
  created: number;
}

// ─── Customer Operations ──────────────────────────────────────────

export async function upsertCustomer(
  db: D1Database,
  customerId: number,
  name?: string
): Promise<void> {
  const ts = nowTs();
  await db
    .prepare(
      `INSERT INTO customers (id, name, created, updated)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = CASE WHEN EXCLUDED.name != '' THEN EXCLUDED.name ELSE customers.name END,
         updated = EXCLUDED.updated`
    )
    .bind(customerId, name ?? "", ts, ts)
    .run();
}

export async function getCustomer(
  db: D1Database,
  customerId: number
): Promise<Customer | null> {
  const result = await db
    .prepare(`SELECT * FROM customers WHERE id = ?`)
    .bind(customerId)
    .first<Customer>();
  return result ?? null;
}

export async function updateCustomerPaymentAddress(
  db: D1Database,
  customerId: number,
  address: string
): Promise<void> {
  const ts = nowTs();
  await db
    .prepare(`UPDATE customers SET payment_address = ?, updated = ? WHERE id = ?`)
    .bind(address, ts, customerId)
    .run();
}

export async function updateCustomerMetadata(
  db: D1Database,
  customerId: number,
  metadata: Record<string, string>
): Promise<void> {
  const ts = nowTs();
  await db
    .prepare(`UPDATE customers SET metadata = ?, updated = ? WHERE id = ?`)
    .bind(JSON.stringify(metadata), ts, customerId)
    .run();
}

/** Helper: parse metadata JSON from customer record. */
export function parseMetadata(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ─── Price Operations ─────────────────────────────────────────────

/**
 * Get unit amount (cents/hour) for a customer in a chat.
 * Falls back to the global default (chat_id = 0) if no group-specific price exists.
 */
export async function getUnitAmount(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<number> {
  // Single query: try group-specific first, fall back to global default (chat_id = 0)
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

  return result?.unit_amount ?? 0;
}

/** Set unit amount for a specific group. */
export async function setUnitAmount(
  db: D1Database,
  customerId: number,
  chatId: number,
  unitAmount: number
): Promise<void> {
  const ts = nowTs();
  await db
    .prepare(
      `INSERT INTO prices (customer_id, chat_id, unit_amount, currency, metadata, created)
       VALUES (?, ?, ?, 'USD', '{}', ?)
       ON CONFLICT(customer_id, chat_id) DO UPDATE SET unit_amount = EXCLUDED.unit_amount`
    )
    .bind(customerId, chatId, unitAmount, ts)
    .run();
}

/** Set global default unit amount (chat_id = 0). */
export async function setDefaultUnitAmount(
  db: D1Database,
  customerId: number,
  unitAmount: number
): Promise<void> {
  await setUnitAmount(db, customerId, 0, unitAmount);
}

// ─── Price Metadata Operations ────────────────────────────────────

const DEFAULT_GRANULARITY_MINUTES = 30;

/**
 * Get granularity_minutes for a customer in a chat.
 * Falls back to the global default price (chat_id = 0), then to 30.
 */
export async function getGranularity(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COALESCE(
        (SELECT metadata FROM prices WHERE customer_id = ?1 AND chat_id = ?2),
        (SELECT metadata FROM prices WHERE customer_id = ?1 AND chat_id = 0),
        '{}'
      ) AS metadata`
    )
    .bind(customerId, chatId)
    .first<{ metadata: string }>();

  const meta = parsePriceMetadata(result?.metadata ?? '{}');
  const g = meta.granularity_minutes;
  return typeof g === 'number' && g > 0 ? g : DEFAULT_GRANULARITY_MINUTES;
}

/** Update price metadata (read-modify-write). Creates a price row if none exists. */
export async function updatePriceMetadata(
  db: D1Database,
  customerId: number,
  chatId: number,
  patch: Record<string, unknown>
): Promise<void> {
  const ts = nowTs();
  // Ensure a price row exists (unit_amount defaults to 0 if not set)
  await db
    .prepare(
      `INSERT INTO prices (customer_id, chat_id, unit_amount, currency, metadata, created)
       VALUES (?, ?, 0, 'USD', '{}', ?)
       ON CONFLICT(customer_id, chat_id) DO NOTHING`
    )
    .bind(customerId, chatId, ts)
    .run();

  // Read current metadata
  const row = await db
    .prepare(`SELECT metadata FROM prices WHERE customer_id = ? AND chat_id = ?`)
    .bind(customerId, chatId)
    .first<{ metadata: string }>();

  const current = parsePriceMetadata(row?.metadata ?? '{}');
  const updated = { ...current, ...patch };

  await db
    .prepare(`UPDATE prices SET metadata = ? WHERE customer_id = ? AND chat_id = ?`)
    .bind(JSON.stringify(updated), customerId, chatId)
    .run();
}

/** Helper: parse price metadata JSON. */
export function parsePriceMetadata(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Get the global default unit amount for display in /start. */
export async function getDefaultUnitAmount(
  db: D1Database,
  customerId: number
): Promise<number> {
  const result = await db
    .prepare(`SELECT unit_amount FROM prices WHERE customer_id = ? AND chat_id = 0`)
    .bind(customerId)
    .first<{ unit_amount: number }>();
  return result?.unit_amount ?? 0;
}

// ─── Work Session Operations ──────────────────────────────────────



export async function undoLastWorkSession(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<{ id: number; duration_minutes: number | null; start_time: number } | null> {
  const result = await db
    .prepare(
      `SELECT id, duration_minutes, start_time FROM work_sessions
       WHERE customer_id = ? AND chat_id = ? AND invoice_id IS NULL
       ORDER BY created DESC LIMIT 1`
    )
    .bind(customerId, chatId)
    .first<{ id: number; duration_minutes: number | null; start_time: number }>();

  if (!result) return null;

  await db
    .prepare(`DELETE FROM work_sessions WHERE id = ?`)
    .bind(result.id)
    .run();

  return result;
}

export async function getActiveSession(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<{ id: number; start_time: number } | null> {
  const result = await db
    .prepare(
      `SELECT id, start_time FROM work_sessions
       WHERE customer_id = ? AND chat_id = ? AND status = ?
       LIMIT 1`
    )
    .bind(customerId, chatId, SESSION_STATUS.ACTIVE)
    .first<{ id: number; start_time: number }>();
  return result ?? null;
}

/** Delete an active session (cancel work). Returns true if a session was deleted. */
export async function deleteActiveSession(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM work_sessions
       WHERE customer_id = ? AND chat_id = ? AND status = ?`
    )
    .bind(customerId, chatId, SESSION_STATUS.ACTIVE)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/**
 * Start a new work session.
 * The UNIQUE partial index (idx_active_session) prevents duplicates at the DB level.
 */
export async function startWorkSession(
  db: D1Database,
  customerId: number,
  chatId: number,
  tag: string | null = null
): Promise<{ id: number; start_time: number }> {
  const ts = nowTs();
  const result = await db
    .prepare(
      `INSERT INTO work_sessions (customer_id, chat_id, status, start_time, tag, created)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, start_time`
    )
    .bind(customerId, chatId, SESSION_STATUS.ACTIVE, ts, tag, ts)
    .first<{ id: number; start_time: number }>();

  if (!result) throw new Error("Failed to create work session");
  return result;
}

export async function completeWorkSession(
  db: D1Database,
  sessionId: number,
  endTime: number,
  durationMins: number
): Promise<void> {
  // Check if there's an open break and close it
  const openBreak = await db
    .prepare(`SELECT id, start_time FROM breaks WHERE work_session_id = ? AND end_time IS NULL`)
    .bind(sessionId)
    .first<{ id: number; start_time: number }>();

  if (openBreak) {
    await resumeWork(db, sessionId);
  }

  // Calculate total break duration to subtract from total elapsed time if we want exact duration,
  // but the handler already passes durationMins.
  // We should probably ensure durationMins is correct if we had breaks.
  // Actually, the handler calculates duration based on start_time and end_time.
  // If we have breaks, we should subtract them.

  const breaks = await db
    .prepare(`SELECT SUM(duration_minutes) as total_break_mins FROM breaks WHERE work_session_id = ?`)
    .bind(sessionId)
    .first<{ total_break_mins: number }>();

  const totalBreakMins = breaks?.total_break_mins ?? 0;
  const finalDuration = Math.max(0, durationMins - totalBreakMins);

  await db
    .prepare(
      `UPDATE work_sessions
       SET status = ?, end_time = ?, duration_minutes = ?
       WHERE id = ?`
    )
    .bind(SESSION_STATUS.COMPLETED, endTime, finalDuration, sessionId)
    .run();
}

/** Start a break for an active work session. */
export async function startBreak(
  db: D1Database,
  sessionId: number
): Promise<void> {
  const ts = nowTs();
  await db
    .prepare(`INSERT INTO breaks (work_session_id, start_time, created) VALUES (?, ?, ?)`)
    .bind(sessionId, ts, ts)
    .run();
}

/** Resume work from a break. */
export async function resumeWork(
  db: D1Database,
  sessionId: number
): Promise<void> {
  const ts = nowTs();
  const openBreak = await db
    .prepare(`SELECT id, start_time FROM breaks WHERE work_session_id = ? AND end_time IS NULL`)
    .bind(sessionId)
    .first<{ id: number; start_time: number }>();

  if (!openBreak) return;

  const durationMins = Math.floor((ts - openBreak.start_time) / 60);

  await db
    .prepare(`UPDATE breaks SET end_time = ?, duration_minutes = ? WHERE id = ?`)
    .bind(ts, durationMins, openBreak.id)
    .run();
}

/** Check if a session is currently on break. */
export async function isOnBreak(
  db: D1Database,
  sessionId: number
): Promise<boolean> {
  const result = await db
    .prepare(`SELECT id FROM breaks WHERE work_session_id = ? AND end_time IS NULL`)
    .bind(sessionId)
    .first();
  return !!result;
}

/**
 * Log a manual work session that is already completed.
 * Used for /work <amount>.
 */
export async function logManualWorkSession(
  db: D1Database,
  customerId: number,
  chatId: number,
  durationMinutes: number,
  tag: string | null = null
): Promise<{ id: number; start_time: number; end_time: number }> {
  const ts = nowTs();
  const startTime = ts - durationMinutes * 60;

  const result = await db
    .prepare(
      `INSERT INTO work_sessions (customer_id, chat_id, status, start_time, end_time, duration_minutes, tag, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, start_time, end_time`
    )
    .bind(customerId, chatId, SESSION_STATUS.COMPLETED, startTime, ts, durationMinutes, tag, ts)
    .first<{ id: number; start_time: number; end_time: number }>();

  if (!result) throw new Error("Failed to log manual work session");
  return result;
}

/** Get completed sessions not yet linked to any invoice. */
export async function getUninvoicedSessions(
  db: D1Database,
  customerId: number,
  chatId: number,
  tag: string | null = null
): Promise<WorkSession[]> {
  let query = `SELECT * FROM work_sessions
       WHERE customer_id = ? AND chat_id = ?
         AND status = ? AND invoice_id IS NULL`;
  const params: any[] = [customerId, chatId, SESSION_STATUS.COMPLETED];

  if (tag) {
    query += ` AND tag = ?`;
    params.push(tag);
  }

  query += ` ORDER BY start_time ASC`;

  const result = await db
    .prepare(query)
    .bind(...params)
    .all<WorkSession>();
  return result.results ?? [];
}

/** Get all active sessions in a chat with user names. */
export async function getGroupActiveSessions(
  db: D1Database,
  chatId: number
): Promise<{ id: number; customer_id: number; customer_name: string; start_time: number }[]> {
  const result = await db
    .prepare(
      `SELECT ws.id, ws.customer_id, c.name as customer_name, ws.start_time
       FROM work_sessions ws
       JOIN customers c ON ws.customer_id = c.id
       WHERE ws.chat_id = ? AND ws.status = ?`
    )
    .bind(chatId, SESSION_STATUS.ACTIVE)
    .all<{ id: number; customer_id: number; customer_name: string; start_time: number }>();
  return result.results ?? [];
}

/** Get unbilled hours and outstanding balance for all members in a group. */
export async function getGroupMemberSummaries(
  db: D1Database,
  chatId: number
): Promise<{
  customer_id: number;
  customer_name: string;
  unbilled_minutes: number;
  outstanding_cents: number;
}[]> {
  // This is a complex query to get both unbilled mins and balance per user in one go
  const result = await db
    .prepare(
      `SELECT
         c.id as customer_id,
         c.name as customer_name,
         COALESCE(ws.unbilled_minutes, 0) as unbilled_minutes,
         COALESCE(bal.outstanding_cents, 0) as outstanding_cents
       FROM customers c
       LEFT JOIN (
         SELECT customer_id, SUM(duration_minutes) as unbilled_minutes
         FROM work_sessions
         WHERE chat_id = ?1 AND status = 'completed' AND invoice_id IS NULL
         GROUP BY customer_id
       ) ws ON c.id = ws.customer_id
       LEFT JOIN (
         SELECT customer_id, SUM(amount) as outstanding_cents
         FROM balance_transactions
         WHERE chat_id = ?1
         GROUP BY customer_id
       ) bal ON c.id = bal.customer_id
       WHERE ws.unbilled_minutes > 0 OR bal.outstanding_cents > 0`
    )
    .bind(chatId)
    .all<{
      customer_id: number;
      customer_name: string;
      unbilled_minutes: number;
      outstanding_cents: number;
    }>();

  return result.results ?? [];
}

/** Get all open invoices in a chat with customer name. Used by chatCleanup. */
export async function getOpenInvoicesByChat(
  db: D1Database,
  chatId: number
): Promise<(Invoice & { customer_name: string })[]> {
  const result = await db
    .prepare(
      `SELECT i.*, c.name AS customer_name FROM invoices i
       JOIN customers c ON i.customer_id = c.id
       WHERE i.chat_id = ? AND i.status = ?
       ORDER BY i.created DESC`
    )
    .bind(chatId, INVOICE_STATUS.OPEN)
    .all<Invoice & { customer_name: string }>();
  return result.results ?? [];
}

// ─── Invoice Operations ───────────────────────────────────────────

/**
 * Create an invoice from uninvoiced sessions.
 *
 * Flow (inspired by Stripe):
 * 1. Create invoice record (status = 'open', auto-finalized)
 * 2. Create invoice_line_items for each session
 * 3. Link sessions to invoice (set invoice_id)
 * 4. Create balance_transaction (receivable)
 *
 * Returns the created invoice.
 */
export async function createInvoice(
  db: D1Database,
  customerId: number,
  chatId: number,
  sessions: WorkSession[],
  unitAmount: number, // cents per hour
  expenses: Expense[] = []
): Promise<Invoice> {
  const ts = nowTs();

  // Calculate totals
  let subtotal = 0;
  const lineItems: { sessionId?: number; expenseId?: number; quantity: number; unitAmount: number; amount: number; description: string }[] = [];

  for (const s of sessions) {
    const mins = s.duration_minutes ?? 0;
    const amount = computeAmount(mins, unitAmount);
    subtotal += amount;
    lineItems.push({
      sessionId: s.id,
      quantity: mins,
      unitAmount: unitAmount,
      amount,
      description: s.tag ? `Work session #${s.id} [${s.tag}]` : `Work session #${s.id}`,
    });
  }

  for (const e of expenses) {
    subtotal += e.amount;
    lineItems.push({
      expenseId: e.id,
      quantity: 1,
      unitAmount: e.amount,
      amount: e.amount,
      description: `Expense: ${e.description ?? 'Unspecified'}`,
    });
  }

  const total = subtotal;
  const periodStart = sessions.length > 0 ? sessions[0].start_time : (expenses.length > 0 ? expenses[0].created : ts);
  const periodEnd = sessions.length > 0 ? sessions[sessions.length - 1].end_time ?? ts : (expenses.length > 0 ? expenses[expenses.length - 1].created : ts);

  // Step 1: Insert invoice
  const invoice = await db
    .prepare(
      `INSERT INTO invoices (
        customer_id, chat_id, status, currency,
        subtotal, total, amount_paid, amount_due,
        period_start, period_end, created, finalized_at
      ) VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?, ?, ?, ?)
      RETURNING *`
    )
    .bind(customerId, chatId, INVOICE_STATUS.OPEN, subtotal, total, total, periodStart, periodEnd, ts, ts)
    .first<Invoice>();

  if (!invoice) throw new Error("Failed to create invoice");

  // Step 2 & 3: Batch insert line items + link sessions/expenses
  const stmts: D1PreparedStatement[] = [];

  for (const item of lineItems) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_amount, amount, work_session_id, created)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(invoice.id, item.description, item.quantity, item.unitAmount, item.amount, item.sessionId ?? null, ts)
    );
    if (item.sessionId) {
      stmts.push(
        db
          .prepare(`UPDATE work_sessions SET invoice_id = ? WHERE id = ?`)
          .bind(invoice.id, item.sessionId)
      );
    }
    if (item.expenseId) {
      stmts.push(
        db
          .prepare(`UPDATE expenses SET invoice_id = ? WHERE id = ?`)
          .bind(invoice.id, item.expenseId)
      );
    }
  }

  // Step 4: Create balance transaction (positive = amount receivable)
  stmts.push(
    db
      .prepare(
        `INSERT INTO balance_transactions (customer_id, chat_id, type, amount, currency, description, source_type, source_id, created)
         VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?)`
      )
      .bind(customerId, chatId, TRANSACTION_TYPE.INVOICE, total, `Invoice #${invoice.id}`, TRANSACTION_TYPE.INVOICE, invoice.id, ts)
  );

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return invoice;
}

/** Get the latest open invoice for auto-linking payments. */
export async function getLatestOpenInvoice(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<Invoice | null> {
  const result = await db
    .prepare(
      `SELECT * FROM invoices
       WHERE customer_id = ? AND chat_id = ? AND status = ?
       ORDER BY created DESC
       LIMIT 1`
    )
    .bind(customerId, chatId, INVOICE_STATUS.OPEN)
    .first<Invoice>();
  return result ?? null;
}

/** Get recent invoices for a customer in a chat (limit 5). */
export async function getRecentInvoices(
  db: D1Database,
  customerId: number,
  chatId: number,
  limit: number = 5
): Promise<Invoice[]> {
  const result = await db
    .prepare(
      `SELECT * FROM invoices
       WHERE customer_id = ? AND chat_id = ?
       ORDER BY created DESC
       LIMIT ?`
    )
    .bind(customerId, chatId, limit)
    .all<Invoice>();
  return result.results ?? [];
}

/** Get recent work sessions for a customer in a chat (limit 10). */
export async function getRecentWorkSessions(
  db: D1Database,
  customerId: number,
  chatId: number,
  limit: number = 10
): Promise<WorkSession[]> {
  const result = await db
    .prepare(
      `SELECT * FROM work_sessions
       WHERE customer_id = ? AND chat_id = ?
       ORDER BY created DESC
       LIMIT ?`
    )
    .bind(customerId, chatId, limit)
    .all<WorkSession>();
  return result.results ?? [];
}

/** Get a single invoice by ID. */
export async function getInvoice(
  db: D1Database,
  invoiceId: number
): Promise<Invoice | null> {
  const result = await db
    .prepare(`SELECT * FROM invoices WHERE id = ?`)
    .bind(invoiceId)
    .first<Invoice>();
  return result ?? null;
}

/**
 * Void an invoice.
 *
 * Flow:
 * 1. Update status to 'void', amount_due to 0, voided_at to now.
 * 2. Add reversing balance transaction (type='adjustment').
 */
export async function voidInvoice(
  db: D1Database,
  invoiceId: number,
  customerId: number,
  chatId: number
): Promise<void> {
  const ts = nowTs();

  // Get invoice details first to reverse the balance
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice || invoice.customer_id !== customerId || invoice.chat_id !== chatId) {
    throw new Error("Invoice not found or access denied");
  }
  if (invoice.status === INVOICE_STATUS.VOID) return; // Already voided

  const stmts: D1PreparedStatement[] = [];

  // Update invoice
  stmts.push(
    db
      .prepare(
        `UPDATE invoices
         SET status = ?, amount_due = 0, voided_at = ?
         WHERE id = ?`
      )
      .bind(INVOICE_STATUS.VOID, ts, invoiceId)
  );

  // Add reversing balance transaction (negative of original total)
  // Original total was positive (receivable).
  // We add negative total to zero it out in the ledger.
  stmts.push(
    db
      .prepare(
        `INSERT INTO balance_transactions (customer_id, chat_id, type, amount, currency, description, source_type, source_id, created)
         VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?)`
      )
      .bind(customerId, chatId, TRANSACTION_TYPE.ADJUSTMENT, -invoice.total, `Void Invoice #${invoice.id}`, TRANSACTION_TYPE.INVOICE, invoice.id, ts)
  );

  await db.batch(stmts);
}

/** Get aggregated balance: total invoiced vs total paid. */
export async function getInvoiceSummary(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<{ total_invoiced: number; total_paid: number }> {
  // Single query: fetch both totals via subqueries to halve D1 round trips
  const result = await db
    .prepare(
      `SELECT
        COALESCE((SELECT SUM(total) FROM invoices WHERE customer_id = ?1 AND chat_id = ?2 AND status != ?3), 0) AS total_invoiced,
        COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id = ?1 AND chat_id = ?2 AND status = ?4), 0) AS total_paid`
    )
    .bind(customerId, chatId, INVOICE_STATUS.VOID, PAYMENT_STATUS.SUCCEEDED)
    .first<{ total_invoiced: number; total_paid: number }>();

  return {
    total_invoiced: result?.total_invoiced ?? 0,
    total_paid: result?.total_paid ?? 0,
  };
}

/** Get the current aggregated balance from balance_transactions. */
export async function getBalance(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT SUM(amount) AS balance FROM balance_transactions
       WHERE customer_id = ? AND chat_id = ?`
    )
    .bind(customerId, chatId)
    .first<{ balance: number }>();
  return result?.balance ?? 0;
}

// ─── Expense Operations ───────────────────────────────────────────

export async function addExpense(
  db: D1Database,
  customerId: number,
  chatId: number,
  amount: number,
  description: string
): Promise<Expense> {
  const ts = nowTs();
  const result = await db
    .prepare(
      `INSERT INTO expenses (customer_id, chat_id, amount, description, created)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(customerId, chatId, amount, description, ts)
    .first<Expense>();

  if (!result) throw new Error("Failed to add expense");
  return result;
}

export async function getUninvoicedExpenses(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<Expense[]> {
  const result = await db
    .prepare(
      `SELECT * FROM expenses
       WHERE customer_id = ? AND chat_id = ? AND invoice_id IS NULL
       ORDER BY created ASC`
    )
    .bind(customerId, chatId)
    .all<Expense>();
  return result.results ?? [];
}

// ─── Payment Operations ──────────────────────────────────────────

/**
 * Record a payment.
 *
 * Flow (inspired by Stripe):
 * 1. Find the latest open invoice for this customer/chat
 * 2. Create payment record (linked to invoice if found)
 * 3. If linked, update invoice's amount_paid / amount_due / status
 * 4. Create balance_transaction (negative = received)
 *
 * Returns the created payment and updated invoice (if any).
 */
export async function recordPayment(
  db: D1Database,
  customerId: number,
  chatId: number,
  amountCents: number
): Promise<{ payment: Payment; invoice: Invoice | null }> {
  const ts = nowTs();

  // Step 1: Find latest open invoice
  const openInvoice = await getLatestOpenInvoice(db, customerId, chatId);
  const invoiceId = openInvoice?.id ?? null;

  // Step 2: Insert payment
  const payment = await db
    .prepare(
      `INSERT INTO payments (customer_id, chat_id, invoice_id, amount, currency, status, created)
       VALUES (?, ?, ?, ?, 'USD', ?, ?)
       RETURNING *`
    )
    .bind(customerId, chatId, invoiceId, amountCents, PAYMENT_STATUS.SUCCEEDED, ts)
    .first<Payment>();

  if (!payment) throw new Error("Failed to record payment");

  const stmts: D1PreparedStatement[] = [];
  let updatedInvoice: Invoice | null = null;

  // Step 3: Update invoice if linked
  if (openInvoice && invoiceId) {
    const newPaid = openInvoice.amount_paid + amountCents;
    const newDue = Math.max(0, openInvoice.total - newPaid);
    const newStatus = newDue <= 0 ? INVOICE_STATUS.PAID : INVOICE_STATUS.OPEN;
    const paidAt = newStatus === INVOICE_STATUS.PAID ? ts : null;

    stmts.push(
      db
        .prepare(
          `UPDATE invoices
           SET amount_paid = ?, amount_due = ?, status = ?, paid_at = COALESCE(?, paid_at)
           WHERE id = ?`
        )
        .bind(newPaid, newDue, newStatus, paidAt, invoiceId)
    );

    updatedInvoice = {
      ...openInvoice,
      amount_paid: newPaid,
      amount_due: newDue,
      status: newStatus,
      paid_at: paidAt ?? openInvoice.paid_at,
    };
  }

  // Step 4: Create balance transaction (negative = money received)
  stmts.push(
    db
      .prepare(
        `INSERT INTO balance_transactions (customer_id, chat_id, type, amount, currency, description, source_type, source_id, created)
         VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?)`
      )
      .bind(customerId, chatId, TRANSACTION_TYPE.PAYMENT, -amountCents, `Payment #${payment.id}`, TRANSACTION_TYPE.PAYMENT, payment.id, ts)
  );

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return { payment, invoice: updatedInvoice };
}

/** Get recent payments for a customer in a chat (limit 10). */
export async function getRecentPayments(
  db: D1Database,
  customerId: number,
  chatId: number,
  limit: number = 10
): Promise<Payment[]> {
  const result = await db
    .prepare(
      `SELECT * FROM payments
       WHERE customer_id = ? AND chat_id = ?
       ORDER BY created DESC
       LIMIT ?`
    )
    .bind(customerId, chatId, limit)
    .all<Payment>();
  return result.results ?? [];
}

// ─── Reset Operations ────────────────────────────────────────────

/** Delete all data for a specific group. */
export async function resetGroupData(
  db: D1Database,
  chatId: number
): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM balance_transactions WHERE chat_id = ?`).bind(chatId),
    db.prepare(`DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE chat_id = ?)`).bind(chatId),
    db.prepare(`DELETE FROM payments WHERE chat_id = ?`).bind(chatId),
    db.prepare(`DELETE FROM invoices WHERE chat_id = ?`).bind(chatId),
    db.prepare(`DELETE FROM work_sessions WHERE chat_id = ?`).bind(chatId),
    db.prepare(`DELETE FROM prices WHERE chat_id = ?`).bind(chatId),
  ]);
}


export async function getStats(
  db: D1Database,
  customerId: number,
  chatId: number,
  sinceTs: number,
  tag: string | null = null
): Promise<{
  total_minutes: number;
  unbilled_minutes: number;
}> {
  let query = `SELECT
         SUM(duration_minutes) as total_minutes,
         SUM(CASE WHEN invoice_id IS NULL THEN duration_minutes ELSE 0 END) as unbilled_minutes
       FROM work_sessions
       WHERE customer_id = ? AND chat_id = ? AND start_time >= ? AND status = ?`;
  const params: any[] = [customerId, chatId, sinceTs, SESSION_STATUS.COMPLETED];

  if (tag) {
    query += ` AND tag = ?`;
    params.push(tag);
  }

  const result = await db
    .prepare(query)
    .bind(...params)
    .first<{ total_minutes: number; unbilled_minutes: number }>();

  return {
    total_minutes: result?.total_minutes || 0,
    unbilled_minutes: result?.unbilled_minutes || 0
  };
}


export async function getAllInvoicesForExport(
  db: D1Database,
  customerId: number
): Promise<any[]> {
  const { results } = await db
    .prepare("SELECT id, chat_id, status, total, amount_paid, amount_due, created FROM invoices WHERE customer_id = ? ORDER BY created DESC")
    .bind(customerId)
    .all();
  return results || [];
}

export async function getAllWorkSessionsForExport(
  db: D1Database,
  customerId: number
): Promise<any[]> {
  const { results } = await db
    .prepare("SELECT id, chat_id, status, start_time, end_time, duration_minutes, invoice_id FROM work_sessions WHERE customer_id = ? ORDER BY created DESC")
    .bind(customerId)
    .all();
  return results || [];
}

/** Get specific invoice balance (amount due). */
export async function getInvoiceAmountDue(
  db: D1Database,
  invoiceId: number,
  customerId: number,
  chatId: number
): Promise<number> {
  const result = await db
    .prepare("SELECT amount_due FROM invoices WHERE id = ? AND customer_id = ? AND chat_id = ?")
    .bind(invoiceId, customerId, chatId)
    .first<{ amount_due: number }>();
  return result?.amount_due ?? 0;
}

/** Get unbilled work summary across all groups for a user. */
export async function getUserGlobalUnbilled(
  db: D1Database,
  customerId: number
): Promise<{ chat_id: number; unbilled_minutes: number; unit_amount: number }[]> {
  // We need to join with prices to get the rate for each group
  const result = await db
    .prepare(
      `SELECT
         ws.chat_id,
         SUM(ws.duration_minutes) as unbilled_minutes,
         COALESCE(p.unit_amount, (SELECT unit_amount FROM prices WHERE customer_id = ?1 AND chat_id = 0), 0) as unit_amount
       FROM work_sessions ws
       LEFT JOIN prices p ON ws.customer_id = p.customer_id AND ws.chat_id = p.chat_id
       WHERE ws.customer_id = ?1 AND ws.status = 'completed' AND ws.invoice_id IS NULL
       GROUP BY ws.chat_id`
    )
    .bind(customerId)
    .all<{ chat_id: number; unbilled_minutes: number; unit_amount: number }>();

  return result.results ?? [];
}

/** Get all customers who have opted in for summaries. */
export async function getCustomersForSummary(
  db: D1Database
): Promise<Customer[]> {
  // Since metadata is JSON, we use SQLite's JSON functions if available,
  // or just filter in JS. D1 supports json_extract.
  const result = await db
    .prepare(`SELECT * FROM customers WHERE json_extract(metadata, '$.summary_frequency') IS NOT NULL AND json_extract(metadata, '$.summary_frequency') != 'off'`)
    .all<Customer>();
  return result.results ?? [];
}
