-- RZ-080: checkout compliance record-keeping. Purely additive columns on
-- checkout_sessions; the payment engine's order-creation/verify/webhook logic is
-- untouched. terms_accepted_at is nullable at the DB level (existing rows predate
-- it) -- requiredness is enforced at the application boundary by
-- checkoutStartSchema (a request without acceptance never reaches this table).

alter table public.checkout_sessions
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists billing_address jsonb;
