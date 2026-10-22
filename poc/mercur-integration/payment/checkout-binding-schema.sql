-- Test-only trusted order/cart/payment-collection projection. Not production migration.
CREATE TABLE np_poc_b305_checkout_authority (
 order_id text PRIMARY KEY REFERENCES np_poc_b3_orders(order_id),
 buyer_id text NOT NULL,
 cart_id text NOT NULL UNIQUE,
 payment_collection_id text NOT NULL UNIQUE,
 medusa_session_id text UNIQUE,
 proof_hash text CHECK(proof_hash IS NULL OR proof_hash ~ '^[0-9a-f]{64}$'),
 lease_until timestamptz
);
