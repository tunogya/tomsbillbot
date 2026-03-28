-- Migration: 0004_stripe_redesign.sql
-- Redesign database schema inspired by Stripe's API object structure.
--
-- Changes:
-- 1. Create customers table (replaces users)
-- 2. Create prices table (replaces user_chat_settings + users.hourly_rate)
-- 3. Restructure work_sessions (status field, integer timestamps, invoice_id FK)
-- 4. Restructure invoices (status machine, integer amounts in cents)
-- 5. Restructure payments (invoice_id FK, integer amounts in cents)
-- 6. Create invoice_line_items table
-- 7. Create balance_transactions table

-- ═══ Step 1: Create customers table ═══
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT DEFAULT '',
  payment_address TEXT DEFAULT '',
  currency TEXT DEFAULT 'USD',
  metadata TEXT DEFAULT '{}',
  created INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0
);

-- Migrate data from users
INSERT INTO customers (id, name, payment_address, currency, metadata, created, updated)
  SELECT
    id,
    '',
    COALESCE(payment_address, ''),
    'USD',
    CASE
      WHEN COALESCE(remark, '') != '' THEN json_object('remark', remark)
      ELSE '{}'
    END,
    CAST(strftime('%s', 'now') AS INTEGER),
    CAST(strftime('%s', 'now') AS INTEGER)
  FROM users;

-- ═══ Step 2: Create prices table ═══
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  unit_amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  created INTEGER NOT NULL DEFAULT 0,
  UNIQUE(customer_id, chat_id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Migrate group-specific rates from user_chat_settings
INSERT INTO prices (customer_id, chat_id, unit_amount, currency, created)
  SELECT
    user_id,
    chat_id,
    CAST(hourly_rate * 100 AS INTEGER),
    'USD',
    CAST(strftime('%s', 'now') AS INTEGER)
  FROM user_chat_settings;

-- Migrate default rates from users (chat_id = 0 means global default)
INSERT OR IGNORE INTO prices (customer_id, chat_id, unit_amount, currency, created)
  SELECT
    id,
    0,
    CAST(hourly_rate * 100 AS INTEGER),
    'USD',
    CAST(strftime('%s', 'now') AS INTEGER)
  FROM users
  WHERE hourly_rate > 0;

-- ═══ Step 3: Restructure work_sessions ═══
CREATE TABLE work_sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration_minutes INTEGER,
  invoice_id INTEGER,
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

INSERT INTO work_sessions_new (id, customer_id, chat_id, status, start_time, end_time, duration_minutes, invoice_id, created)
  SELECT
    id,
    user_id,
    chat_id,
    CASE WHEN end_time IS NULL THEN 'active' ELSE 'completed' END,
    CAST(strftime('%s', start_time) AS INTEGER),
    CASE WHEN end_time IS NOT NULL THEN CAST(strftime('%s', end_time) AS INTEGER) ELSE NULL END,
    CASE WHEN duration IS NOT NULL THEN CAST(duration * 60 AS INTEGER) ELSE NULL END,
    NULL,
    CAST(strftime('%s', COALESCE(start_time, 'now')) AS INTEGER)
  FROM work_sessions;

DROP TABLE work_sessions;
ALTER TABLE work_sessions_new RENAME TO work_sessions;

-- ═══ Step 4: Restructure invoices ═══
CREATE TABLE invoices_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT DEFAULT 'USD',
  subtotal INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  amount_due INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  metadata TEXT DEFAULT '{}',
  period_start INTEGER,
  period_end INTEGER,
  created INTEGER NOT NULL DEFAULT 0,
  finalized_at INTEGER,
  paid_at INTEGER,
  voided_at INTEGER,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

INSERT INTO invoices_new (id, customer_id, chat_id, status, currency, subtotal, total, amount_paid, amount_due, created, finalized_at)
  SELECT
    id,
    user_id,
    COALESCE(chat_id, 0),
    CASE
      WHEN COALESCE(paid_amount, 0) >= total_amount THEN 'paid'
      ELSE 'open'
    END,
    'USD',
    CAST(total_amount * 100 AS INTEGER),
    CAST(total_amount * 100 AS INTEGER),
    CAST(COALESCE(paid_amount, 0) * 100 AS INTEGER),
    MAX(0, CAST((total_amount - COALESCE(paid_amount, 0)) * 100 AS INTEGER)),
    CAST(strftime('%s', created_at) AS INTEGER),
    CAST(strftime('%s', created_at) AS INTEGER)
  FROM invoices;

DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;

-- ═══ Step 5: Restructure payments ═══
CREATE TABLE payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  invoice_id INTEGER,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'succeeded',
  description TEXT,
  metadata TEXT DEFAULT '{}',
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

INSERT INTO payments_new (id, customer_id, chat_id, invoice_id, amount, currency, status, created)
  SELECT
    id,
    user_id,
    COALESCE(chat_id, 0),
    NULL,
    CAST(amount * 100 AS INTEGER),
    'USD',
    'succeeded',
    CAST(strftime('%s', created_at) AS INTEGER)
  FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

-- ═══ Step 6: Create invoice_line_items table ═══
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL,
  unit_amount INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  work_session_id INTEGER,
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  FOREIGN KEY (work_session_id) REFERENCES work_sessions(id)
);

-- ═══ Step 7: Create balance_transactions table ═══
CREATE TABLE IF NOT EXISTS balance_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  description TEXT,
  source_type TEXT,
  source_id INTEGER,
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ═══ Step 8: Recreate indexes ═══
CREATE INDEX IF NOT EXISTS idx_prices_customer_chat ON prices(customer_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_sessions_customer_chat ON work_sessions(customer_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON work_sessions(status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_chat ON invoices(customer_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_chat ON payments(customer_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_balance_tx_customer_chat ON balance_transactions(customer_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_balance_tx_source ON balance_transactions(source_type, source_id);

-- Unique constraint: one active session per user per group
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_session
  ON work_sessions (customer_id, chat_id)
  WHERE status = 'active';

-- ═══ Step 9: Drop old tables ═══
DROP TABLE IF EXISTS user_chat_settings;
DROP TABLE IF EXISTS users;
