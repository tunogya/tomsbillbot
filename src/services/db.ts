/**
 * Database service layer — Stripe-inspired object model.
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
      `INSERT INTO prices (customer_id, chat_id, unit_amount, currency, created)
       VALUES (?, ?, ?, 'USD', ?)
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

export async function getActiveSession(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<{ id: number; start_time: number } | null> {
  const result = await db
    .prepare(
      `SELECT id, start_time FROM work_sessions
       WHERE customer_id = ? AND chat_id = ? AND status = 'active'
       LIMIT 1`
    )
    .bind(customerId, chatId)
    .first<{ id: number; start_time: number }>();
  return result ?? null;
}

/**
 * Start a new work session.
 * The UNIQUE partial index (idx_active_session) prevents duplicates at the DB level.
 */
export async function startWorkSession(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<{ id: number; start_time: number }> {
  const ts = nowTs();
  const result = await db
    .prepare(
      `INSERT INTO work_sessions (customer_id, chat_id, status, start_time, created)
       VALUES (?, ?, 'active', ?, ?)
       RETURNING id, start_time`
    )
    .bind(customerId, chatId, ts, ts)
    .first<{ id: number; start_time: number }>();

  if (!result) throw new Error("Failed to create work session");
  return result;
}

/** Complete a work session. */
export async function completeWorkSession(
  db: D1Database,
  sessionId: number,
  endTime: number,
  durationMins: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE work_sessions
       SET status = 'completed', end_time = ?, duration_minutes = ?
       WHERE id = ?`
    )
    .bind(endTime, durationMins, sessionId)
    .run();
}

/** Get completed sessions not yet linked to any invoice. */
export async function getUninvoicedSessions(
  db: D1Database,
  customerId: number,
  chatId: number
): Promise<WorkSession[]> {
  const result = await db
    .prepare(
      `SELECT * FROM work_sessions
       WHERE customer_id = ? AND chat_id = ?
         AND status = 'completed' AND invoice_id IS NULL
       ORDER BY start_time ASC`
    )
    .bind(customerId, chatId)
    .all<WorkSession>();
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
  unitAmount: number // cents per hour
): Promise<Invoice> {
  const ts = nowTs();

  // Calculate totals
  let subtotal = 0;
  const lineItems: { sessionId: number; minutes: number; amount: number; description: string }[] = [];

  for (const s of sessions) {
    const mins = s.duration_minutes ?? 0;
    const amount = computeAmount(mins, unitAmount);
    subtotal += amount;
    lineItems.push({
      sessionId: s.id,
      minutes: mins,
      amount,
      description: `Work session #${s.id}`,
    });
  }

  const total = subtotal;
  const periodStart = sessions.length > 0 ? sessions[0].start_time : ts;
  const periodEnd = sessions.length > 0 ? sessions[sessions.length - 1].end_time ?? ts : ts;

  // Step 1: Insert invoice
  const invoice = await db
    .prepare(
      `INSERT INTO invoices (
        customer_id, chat_id, status, currency,
        subtotal, total, amount_paid, amount_due,
        period_start, period_end, created, finalized_at
      ) VALUES (?, ?, 'open', 'USD', ?, ?, 0, ?, ?, ?, ?, ?)
      RETURNING *`
    )
    .bind(customerId, chatId, subtotal, total, total, periodStart, periodEnd, ts, ts)
    .first<Invoice>();

  if (!invoice) throw new Error("Failed to create invoice");

  // Step 2 & 3: Batch insert line items + link sessions
  const stmts: D1PreparedStatement[] = [];

  for (const item of lineItems) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_amount, amount, work_session_id, created)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(invoice.id, item.description, item.minutes, unitAmount, item.amount, item.sessionId, ts)
    );
    stmts.push(
      db
        .prepare(`UPDATE work_sessions SET invoice_id = ? WHERE id = ?`)
        .bind(invoice.id, item.sessionId)
    );
  }

  // Step 4: Create balance transaction (positive = amount receivable)
  stmts.push(
    db
      .prepare(
        `INSERT INTO balance_transactions (customer_id, chat_id, type, amount, currency, description, source_type, source_id, created)
         VALUES (?, ?, 'invoice', ?, 'USD', ?, 'invoice', ?, ?)`
      )
      .bind(customerId, chatId, total, `Invoice #${invoice.id}`, invoice.id, ts)
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
       WHERE customer_id = ? AND chat_id = ? AND status = 'open'
       ORDER BY created DESC
       LIMIT 1`
    )
    .bind(customerId, chatId)
    .first<Invoice>();
  return result ?? null;
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
        COALESCE((SELECT SUM(total) FROM invoices WHERE customer_id = ?1 AND chat_id = ?2 AND status != 'void'), 0) AS total_invoiced,
        COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id = ?1 AND chat_id = ?2 AND status = 'succeeded'), 0) AS total_paid`
    )
    .bind(customerId, chatId)
    .first<{ total_invoiced: number; total_paid: number }>();

  return {
    total_invoiced: result?.total_invoiced ?? 0,
    total_paid: result?.total_paid ?? 0,
  };
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
       VALUES (?, ?, ?, ?, 'USD', 'succeeded', ?)
       RETURNING *`
    )
    .bind(customerId, chatId, invoiceId, amountCents, ts)
    .first<Payment>();

  if (!payment) throw new Error("Failed to record payment");

  const stmts: D1PreparedStatement[] = [];
  let updatedInvoice: Invoice | null = null;

  // Step 3: Update invoice if linked
  if (openInvoice && invoiceId) {
    const newPaid = openInvoice.amount_paid + amountCents;
    const newDue = Math.max(0, openInvoice.total - newPaid);
    const newStatus = newDue <= 0 ? "paid" : "open";
    const paidAt = newStatus === "paid" ? ts : null;

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
         VALUES (?, ?, 'payment', ?, 'USD', ?, 'payment', ?, ?)`
      )
      .bind(customerId, chatId, -amountCents, `Payment #${payment.id}`, payment.id, ts)
  );

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return { payment, invoice: updatedInvoice };
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
