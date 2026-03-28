-- Migration: 0002_group_isolation.sql
-- Add support for group-specific rates and isolate invoices/payments per group.

-- Table for per-group user settings (personalized rate)
CREATE TABLE IF NOT EXISTS user_chat_settings (
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  hourly_rate REAL NOT NULL,
  PRIMARY KEY (user_id, chat_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Add chat_id to invoices
-- SQLite doesn't support adding a column with NOT NULL without a default value
-- We'll add it as NULLable first or with a default (0 for legacy)
ALTER TABLE invoices ADD COLUMN chat_id INTEGER DEFAULT 0;

-- Add chat_id to payments
ALTER TABLE payments ADD COLUMN chat_id INTEGER DEFAULT 0;

-- Index for efficient group lookups
CREATE INDEX IF NOT EXISTS idx_invoices_user_chat ON invoices(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_chat ON payments(user_id, chat_id);
