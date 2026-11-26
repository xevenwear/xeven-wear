DROP INDEX IF EXISTS manual_transfer_orders_unique_amount;

CREATE UNIQUE INDEX IF NOT EXISTS manual_transfer_orders_unique_amount
  ON manual_transfer_orders(transfer_uzs)
  WHERE status IN ('awaiting_transfer', 'partially_paid');
