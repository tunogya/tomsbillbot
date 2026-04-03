-- Add tags to work sessions
ALTER TABLE work_sessions ADD COLUMN tag TEXT;

-- Breaks table for pause/resume support
CREATE TABLE IF NOT EXISTS breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_session_id INTEGER NOT NULL,
  start_time INTEGER NOT NULL,             -- Unix timestamp
  end_time INTEGER,                        -- Unix timestamp
  duration_minutes INTEGER,
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (work_session_id) REFERENCES work_sessions(id)
);

-- Expenses table for non-time expenses
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,                 -- cents
  currency TEXT DEFAULT 'USD',
  description TEXT,
  invoice_id INTEGER,                      -- nullable FK
  created INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_breaks_session ON breaks(work_session_id);
CREATE INDEX IF NOT EXISTS idx_expenses_customer_chat ON expenses(customer_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_expenses_invoice ON expenses(invoice_id);
