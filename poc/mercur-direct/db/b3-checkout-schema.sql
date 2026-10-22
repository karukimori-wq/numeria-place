-- PoC B3-03 ONLY: disposable PostgreSQL schema. Do not migrate production.
-- One order has one listing, one seller, and a snapshot of the seller account.
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
  UNIQUE (seller_id,account_id)
);
CREATE TABLE np_poc_b3_listings (
  listing_id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES np_poc_b3_sellers(seller_id),
  status text NOT NULL CHECK (status IN ('published','hidden')),
  UNIQUE (listing_id,seller_id)
);
CREATE TABLE np_poc_b3_orders (
  order_id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES np_poc_b3_sellers(seller_id),
  listing_id text NOT NULL,
  account_id text NOT NULL CHECK (account_id ~ '^acct_[A-Za-z0-9]+$'),
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
CREATE TABLE np_poc_b3_payment_intents (
  session_id text PRIMARY KEY REFERENCES np_poc_b3_payment_sessions(session_id),
  intent_id text NOT NULL UNIQUE CHECK (intent_id ~ '^pi_[A-Za-z0-9]+$'),
  order_id text NOT NULL REFERENCES np_poc_b3_orders(order_id),
  seller_id text NOT NULL REFERENCES np_poc_b3_sellers(seller_id),
  account_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'jpy'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (seller_id,account_id) REFERENCES np_poc_b3_connect_accounts(seller_id,account_id)
);
CREATE INDEX np_poc_b3_orders_seller_idx ON np_poc_b3_orders(seller_id);
-- Composite FKs prevent cross-seller listing/account assignment at insert.
-- API must separately enforce immutable snapshots and tenant authorization.
