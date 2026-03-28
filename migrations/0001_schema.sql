-- Billbot consolidated schema
-- Merged from: 0001, 0002, 0003, 0004

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,          -- Telegram user_id
  hourly_rate REAL DEFAULT 0,
  payment_address TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS work_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  start_time TEXT NOT NULL,        -- ISO 8601 UTC
  end_time TEXT,
  duration REAL,                   -- hours (float)
  invoiced INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total_amount REAL NOT NULL,
  paid_amount REAL DEFAULT 0,
  created_at TEXT NOT NULL,        -- ISO 8601 UTC
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,        -- ISO 8601 UTC
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_chat ON work_sessions(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_sessions_invoiced ON work_sessions(invoiced);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

-- Prevent duplicate active sessions (one per user per group)
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_session
  ON work_sessions (user_id, chat_id)
  WHERE end_time IS NULL;
