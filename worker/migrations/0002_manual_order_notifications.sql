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
