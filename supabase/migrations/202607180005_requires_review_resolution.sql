-- RZ-050: requires_review resolution + reconciliation support.
-- Extends (does not rewrite) complete_razorpay_checkout: the only functional change
-- is allowing a session already flagged 'requires_review' to be retried, so a
-- stranded capture (money taken, order never created due to a transient failure)
-- can be resolved by re-running the exact same atomic order-creation logic that
-- already runs for every normal checkout. Every other line is unchanged.

alter table public.checkout_sessions
  add column if not exists resolution_note varchar(1000),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

create index if not exists checkout_sessions_requires_review_idx
  on public.checkout_sessions(created_at desc)
  where status = 'requires_review' and resolved_at is null;

create or replace function public.complete_razorpay_checkout(
  p_checkout_session_id uuid,
  p_provider_payment_id varchar,
  p_payment_method varchar,
  p_captured_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  checkout_record public.checkout_sessions;
  created_order_id uuid;
begin
  select * into checkout_record
  from public.checkout_sessions
  where id = p_checkout_session_id
  for update;

  if not found then raise exception 'CHECKOUT_NOT_FOUND'; end if;
  if checkout_record.status = 'completed' then return checkout_record.order_id; end if;
  -- 'requires_review' added: lets an admin-triggered retry (RZ-050) complete a
  -- stranded capture using this same, already-audited order-creation path.
  if checkout_record.status not in ('payment_pending', 'requires_review') then raise exception 'CHECKOUT_STATE_INVALID'; end if;
  if checkout_record.razorpay_order_id is null then raise exception 'PROVIDER_ORDER_MISSING'; end if;

  perform variant.id
  from public.product_variants variant
  join public.checkout_session_items item on item.product_variant_id = variant.id
  where item.checkout_session_id = p_checkout_session_id
  order by variant.id
  for update of variant;

  if exists (
    select 1
    from public.checkout_session_items item
    join public.product_variants variant on variant.id = item.product_variant_id
    left join public.inventory_reservations reservation
      on reservation.checkout_session_id = item.checkout_session_id
      and reservation.product_variant_id = item.product_variant_id
      and reservation.status = 'active'
    where item.checkout_session_id = p_checkout_session_id
      and (reservation.id is null or reservation.quantity < item.quantity or variant.stock_quantity < item.quantity)
  ) then raise exception 'INVENTORY_RESERVATION_LOST'; end if;

  insert into public.orders (
    customer_user_id, customer_name, customer_email, customer_phone, shipping_address,
    status, source, currency, subtotal_minor, discount_minor, shipping_minor, tax_minor,
    total_minor, customer_note, placed_at, payment_status, paid_at, created_by, updated_by
  ) values (
    checkout_record.user_id, checkout_record.customer_name, checkout_record.customer_email,
    checkout_record.customer_phone, checkout_record.shipping_address, 'pending', 'checkout',
    checkout_record.currency, checkout_record.subtotal_minor, checkout_record.discount_minor,
    checkout_record.shipping_minor, checkout_record.tax_minor, checkout_record.total_minor,
    checkout_record.customer_note, p_captured_at, 'paid', p_captured_at,
    checkout_record.user_id, checkout_record.user_id
  ) returning id into created_order_id;

  insert into public.order_items (
    order_id, product_id, product_variant_id, product_name, sku,
    quantity, unit_price_minor, line_total_minor
  )
  select created_order_id, product_id, product_variant_id, product_name, sku,
    quantity, unit_price_minor, line_total_minor
  from public.checkout_session_items
  where checkout_session_id = p_checkout_session_id;

  update public.product_variants variant
  set stock_quantity = variant.stock_quantity - item.quantity
  from public.checkout_session_items item
  where item.checkout_session_id = p_checkout_session_id
    and variant.id = item.product_variant_id;

  update public.inventory_reservations
  set status = 'converted'
  where checkout_session_id = p_checkout_session_id and status = 'active';

  insert into public.order_status_history (order_id, from_status, to_status, reason, changed_by)
  values (created_order_id, null, 'pending', 'Razorpay payment captured', checkout_record.user_id);

  insert into public.payment_attempts (
    checkout_session_id, provider, provider_order_id, provider_payment_id,
    status, amount_minor, currency, method
  ) values (
    p_checkout_session_id, 'razorpay', checkout_record.razorpay_order_id,
    p_provider_payment_id, 'captured', checkout_record.total_minor,
    checkout_record.currency, left(p_payment_method, 40)
  )
  on conflict (provider, provider_payment_id)
  do update set status = 'captured', method = excluded.method;

  update public.checkout_sessions
  set status = 'completed', razorpay_payment_id = p_provider_payment_id,
    order_id = created_order_id, completed_at = p_captured_at
  where id = p_checkout_session_id;

  if checkout_record.cart_id is not null then
    update public.carts set status = 'converted'
    where id = checkout_record.cart_id and status = 'active';
  end if;

  return created_order_id;
end;
$$;
