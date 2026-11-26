CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  paid_at INTEGER,
  customer_telegram_id TEXT NOT NULL,
  customer_username TEXT,
  customer_first_name TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('ru', 'uz')),
  payment_provider TEXT NOT NULL CHECK (payment_provider IN ('payme', 'click')),
  total_uzs INTEGER NOT NULL CHECK (total_uzs > 0),
  items_json TEXT NOT NULL,
  notification_claimed_at INTEGER,
  notification_sent_at INTEGER,
  notification_error TEXT
);

CREATE INDEX IF NOT EXISTS orders_unnotified_paid
  ON orders(status, notification_sent_at, paid_at);

CREATE TABLE IF NOT EXISTS payme_transactions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  state INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  create_time INTEGER NOT NULL,
  perform_time INTEGER NOT NULL DEFAULT 0,
  cancel_time INTEGER NOT NULL DEFAULT 0,
  reason INTEGER
);

CREATE INDEX IF NOT EXISTS payme_transactions_order_state
  ON payme_transactions(order_id, state);

CREATE UNIQUE INDEX IF NOT EXISTS payme_one_active_transaction_per_order
  ON payme_transactions(order_id) WHERE state = 1;

CREATE TABLE IF NOT EXISTS click_transactions (
  click_trans_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'completed', 'cancelled')),
  click_paydoc_id TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS click_one_prepared_transaction_per_order
  ON click_transactions(order_id) WHERE status = 'prepared';

CREATE TABLE IF NOT EXISTS manual_transfer_orders (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_transfer', 'partially_paid', 'paid', 'cancelled')),
  customer_telegram_id TEXT NOT NULL,
  customer_username TEXT,
  customer_first_name TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('ru', 'uz')),
  total_uzs INTEGER NOT NULL CHECK (total_uzs > 0),
  deposit_uzs INTEGER NOT NULL CHECK (deposit_uzs > 0),
  transfer_uzs INTEGER NOT NULL CHECK (transfer_uzs >= deposit_uzs),
  tail_uzs INTEGER NOT NULL CHECK (tail_uzs BETWEEN 1 AND 99),
  remaining_uzs INTEGER NOT NULL CHECK (remaining_uzs >= 0),
  items_json TEXT NOT NULL,
  deposit_confirmed_at INTEGER,
  balance_confirmed_at INTEGER,
  notification_claimed_at INTEGER,
  notification_sent_at INTEGER,
  notification_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_transfer_orders_unique_amount
  ON manual_transfer_orders(transfer_uzs)
  WHERE status IN ('awaiting_transfer', 'partially_paid');

CREATE INDEX IF NOT EXISTS manual_transfer_orders_open
  ON manual_transfer_orders(status, created_at);

CREATE TABLE IF NOT EXISTS manual_order_notifications (
  order_id TEXT NOT NULL REFERENCES manual_transfer_orders(id),
  recipient TEXT NOT NULL CHECK (recipient IN ('owner', 'customer')),
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  sent_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (order_id, recipient)
);

CREATE INDEX IF NOT EXISTS manual_order_notifications_pending
  ON manual_order_notifications(sent_at, claimed_at, created_at);
