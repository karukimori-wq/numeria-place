-- B3-04b: isolated inbox/NS-intake/outbox on SAME B3-03/B3-04a DB.
-- These are PoC-only tables; no production migration.
CREATE TABLE np_poc_b3_webhook_inbox (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  intent_id text NOT NULL REFERENCES np_poc_b3_payment_intents(intent_id),
  order_id text NOT NULL REFERENCES np_poc_b3_orders(order_id),
  seller_id text NOT NULL REFERENCES np_poc_b3_sellers(seller_id),
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX np_poc_b3_inbox_order_idx ON np_poc_b3_webhook_inbox(order_id);
CREATE TABLE np_poc_b3_ns_intake (
  order_id text PRIMARY KEY REFERENCES np_poc_b3_orders(order_id),
  seller_id text NOT NULL REFERENCES np_poc_b3_sellers(seller_id),
  intent_id text NOT NULL UNIQUE REFERENCES np_poc_b3_payment_intents(intent_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE np_poc_b3_paid_outbox (
  order_id text PRIMARY KEY REFERENCES np_poc_b3_orders(order_id),
  seller_id text NOT NULL REFERENCES np_poc_b3_sellers(seller_id),
  event_type text NOT NULL CHECK (event_type='np.order.paid.v1'),
  created_at timestamptz NOT NULL DEFAULT now()
);
