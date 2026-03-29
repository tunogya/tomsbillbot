-- Billbot consolidated schema
-- Merged from: 0001_schema, 0002_group_isolation, 0003_add_user_remark, 0004_stripe_redesign
-- This is the final schema after all migrations have been applied.

-- ═══ Customers ═══
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,            -- Telegram user_id
  name TEXT DEFAULT '',
  payment_address TEXT DEFAULT '',
  currency TEXT DEFAULT 'USD',
  metadata TEXT DEFAULT '{}',        -- JSON, e.g. {"remark": "..."}
  created INTEGER NOT NULL DEFAULT 0,  -- Unix timestamp
  updated INTEGER NOT NULL DEFAULT 0   -- Unix timestamp
);

-- ═══ Prices (per-customer per-group hourly rate) ═══
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,          -- 0 = global default
  unit_amount INTEGER NOT NULL,      -- cents per hour
  currency TEXT DEFAULT 'USD',
  metadata TEXT DEFAULT '{}',        -- JSON, e.g. {"granularity_minutes": 30}
  created INTEGER NOT NULL DEFAULT 0,
  UNIQUE(customer_id, chat_id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ═══ Work Sessions ═══
CREATE TABLE IF NOT EXISTS work_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- active | completed
  start_time INTEGER NOT NULL,             -- Unix timestamp
  end_time INTEGER,                        -- Unix timestamp
  duration_minutes INTEGER,
  invoice_id INTEGER,
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ═══ Invoices ═══
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | open | paid | void
  currency TEXT DEFAULT 'USD',
  subtotal INTEGER NOT NULL DEFAULT 0,     -- cents
  total INTEGER NOT NULL DEFAULT 0,        -- cents
  amount_paid INTEGER NOT NULL DEFAULT 0,  -- cents
  amount_due INTEGER NOT NULL DEFAULT 0,   -- cents
  description TEXT,
  metadata TEXT DEFAULT '{}',
  period_start INTEGER,                    -- Unix timestamp
  period_end INTEGER,                      -- Unix timestamp
  created INTEGER NOT NULL DEFAULT 0,
  finalized_at INTEGER,
  paid_at INTEGER,
  voided_at INTEGER,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ═══ Invoice Line Items ═══
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL,
  unit_amount INTEGER NOT NULL,            -- cents
  amount INTEGER NOT NULL,                 -- cents
  work_session_id INTEGER,
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  FOREIGN KEY (work_session_id) REFERENCES work_sessions(id)
);

-- ═══ Payments ═══
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  invoice_id INTEGER,
  amount INTEGER NOT NULL,                 -- cents
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'succeeded',         -- succeeded | failed | refunded
  description TEXT,
  metadata TEXT DEFAULT '{}',
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

-- ═══ Balance Transactions (ledger) ═══
CREATE TABLE IF NOT EXISTS balance_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  type TEXT NOT NULL,                      -- invoice | payment | adjustment
  amount INTEGER NOT NULL,                 -- cents (positive = credit, negative = debit)
  currency TEXT DEFAULT 'USD',
  description TEXT,
  source_type TEXT,                        -- invoice | payment
  source_id INTEGER,
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ═══ Indexes ═══
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
