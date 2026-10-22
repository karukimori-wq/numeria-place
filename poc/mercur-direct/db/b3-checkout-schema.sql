-- PoC B3-03 ONLY: disposable PostgreSQL schema. Do not migrate production.
-- One NP order references exactly one listing; order amount/fee/account are snapshots.
CREATE TABLE np_poc_b3_sellers (
  seller_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('active','suspended')),
  kyc_status text NOT NULL CHECK (kyc_status IN ('verified','pending','restricted'))
);
CREATE TABLE np_poc_b3_connect_accounts (
  seller_id text PRIMARY KEY REFERENCES np_poc_b3_sellers(seller_id),
  account_id text NOT NULL UNIQUE CHECK (account_id ~ '^acct_[A-Za-z0-9]+$'),
  charges_enabled boolean NOT NULL DEFAULT false,
  account_status text NOT NULL CHECK (account_status IN ('active','restricted')),
  UNIQUE(seller_id,account_id)
);
CREATE TABLE np_poc_b3_listings (
  listing_id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES np_poc_b3_sellers(seller_id),
  status text NOT NULL CHECK (status IN ('published','hidden')),
  UNIQUE(listing_id,seller_id)
);
CREATE TABLE np_poc_b3_orders (
  order_id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES np_poc_b3_sellers(seller_id),
  listing_id text NOT NULL,
  account_id text NOT NULL CHECK (account_id ~ '^acct_[A-Za-z0-9]+
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0 AND fee_minor <= amount_minor),
  currency text NOT NULL CHECK (currency = 'jpy'),
  state text NOT NULL CHECK (state IN ('pending','paid','cancelled')),
  FOREIGN KEY (listing_id,seller_id) REFERENCES np_poc_b3_listings(listing_id,seller_id),
  FOREIGN KEY (seller_id,account_id) REFERENCES np_poc_b3_connect_accounts(seller_id,account_id)
);
CREATE TABLE np_poc_b3_payment_sessions (
  session_id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES np_poc_b3_orders(order_id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX np_poc_b3_orders_seller_idx ON np_poc_b3_orders(seller_id);
-- Composite FKs reject cross-seller listing/account references at write time.
-- Immutable order snapshot and authorization must still be enforced in app/API.
),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0 AND fee_minor <= amount_minor),
  currency text NOT NULL CHECK (currency = 'jpy'),
  state text NOT NULL CHECK (state IN ('pending','paid','cancelled'))
);
CREATE TABLE np_poc_b3_payment_sessions (
  session_id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES np_poc_b3_orders(order_id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX np_poc_b3_orders_seller_idx ON np_poc_b3_orders(seller_id);
-- NOTE: DDL alone cannot guarantee cross-table seller equality, enforce via
-- resolver join and test; production schema must add immutable composite FKs.
