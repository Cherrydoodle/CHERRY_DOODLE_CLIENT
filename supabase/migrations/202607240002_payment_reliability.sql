-- RZ-AUDIT: payment reliability.
--
-- Closes the three paths found by the pre-production audit where Razorpay captures
-- a customer's money but no order is ever created:
--   H-1  the customer retries inside the Razorpay modal after a declined attempt.
--        The first attempt's payment.failed webhook had already released the
--        reservation and moved the session to 'failed', so the successful retry
--        (same razorpay_order_id) could no longer be completed.
--   H-3  the customer completes a slow bank/UPI flow after the 20-minute
--        reservation lapsed and checkout-cleanup marked the session 'expired'.
--   H-6  no order-confirmation email existed at all.
--
-- H-1/H-3 are handled by reclaim_checkout_for_capture below: before giving up on a
-- capture, the application asks the database to put the session back into a
-- completable state, re-reserving stock if it is still available. Only when that is
-- impossible does the capture become a refund (application side) or a review item.
--
-- H-6 is handled by inserting the confirmation into email_outbox *inside*
-- complete_razorpay_checkout's transaction, so an order can never exist without its
-- confirmation being queued, and a rolled-back order never queues a stray email.

-- Re-activates a checkout that a failed/expired transition took out of
-- 'payment_pending', so a genuine capture can still become an order.
-- Returns true when the session is completable, false when it is not (stock gone).
--
-- Deliberately does NOT re-check product publish status or variant is_active: the
-- customer has already paid, so the only question that matters is whether the goods
-- are physically still there. Stock is the sole gate.
create or replace function public.reclaim_checkout_for_capture(p_checkout_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  checkout_record public.checkout_sessions;
  reclaim_window constant interval := interval '20 minutes';
begin
  select * into checkout_record
  from public.checkout_sessions
  where id = p_checkout_session_id
  for update;

  if not found then return false; end if;
  -- Already completable (or already done): nothing to reclaim.
  if checkout_record.status in ('completed', 'payment_pending') then return true; end if;
  -- 'creating_payment' means the Razorpay order was never linked; a capture against
  -- it cannot be trusted to belong here, so it is never reclaimed.
  if checkout_record.status not in ('failed', 'expired', 'requires_review') then return false; end if;

  perform variant.id
  from public.product_variants variant
  join public.checkout_session_items item on item.product_variant_id = variant.id
  where item.checkout_session_id = p_checkout_session_id
  order by variant.id
  for update of variant;

  -- Race case (H-1): payment.failed and payment.captured processed concurrently, so
  -- the reservation rows are still active. Just restore the status.
  if exists (
    select 1 from public.inventory_reservations
    where checkout_session_id = p_checkout_session_id and status = 'active' and expires_at > now()
  ) then
    update public.checkout_sessions set status = 'payment_pending' where id = p_checkout_session_id;
    return true;
  end if;

  -- Otherwise the reservation is gone and the stock must still be free, counting
  -- every OTHER session's live reservations against it.
  if exists (
    select 1
    from public.checkout_session_items item
    join public.product_variants variant on variant.id = item.product_variant_id
    left join lateral (
      select coalesce(sum(reservation.quantity), 0)::integer as reserved_quantity
      from public.inventory_reservations reservation
      where reservation.product_variant_id = variant.id
        and reservation.status = 'active'
        and reservation.expires_at > now()
        and reservation.checkout_session_id <> p_checkout_session_id
    ) reserved on true
    where item.checkout_session_id = p_checkout_session_id
      and variant.stock_quantity - reserved.reserved_quantity < item.quantity
  ) then
    return false;
  end if;

  insert into public.inventory_reservations (
    checkout_session_id, product_variant_id, quantity, status, expires_at
  )
  select item.checkout_session_id, item.product_variant_id, item.quantity, 'active', now() + reclaim_window
  from public.checkout_session_items item
  where item.checkout_session_id = p_checkout_session_id
  on conflict (checkout_session_id, product_variant_id)
  do update set status = 'active', quantity = excluded.quantity, expires_at = excluded.expires_at;

  update public.checkout_sessions
  set status = 'payment_pending', reservation_expires_at = now() + reclaim_window
  where id = p_checkout_session_id;

  return true;
end;
$$;

-- Unchanged from 202607150003 except: the created order number is captured, and the
-- order-confirmation email is queued in the same transaction (H-6).
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
  created_order_number varchar(32);
begin
  select * into checkout_record
  from public.checkout_sessions
  where id = p_checkout_session_id
  for update;

  if not found then raise exception 'CHECKOUT_NOT_FOUND'; end if;
  if checkout_record.status = 'completed' then return checkout_record.order_id; end if;
  if checkout_record.status <> 'payment_pending' then raise exception 'CHECKOUT_STATE_INVALID'; end if;
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
  ) returning id, order_number into created_order_id, created_order_number;

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

  -- H-6: transactional outbox. Same transaction as the order, so the two can never
  -- disagree; features/email/service.ts drains it through Resend.
  insert into public.email_outbox (message_type, recipient_email, payload)
  values (
    'order_confirmation',
    checkout_record.customer_email,
    jsonb_build_object(
      'orderId', created_order_id,
      'orderNumber', created_order_number,
      'customerName', checkout_record.customer_name,
      'currency', checkout_record.currency,
      'totalMinor', checkout_record.total_minor,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', item.product_name,
          'quantity', item.quantity,
          'lineTotalMinor', item.line_total_minor
        ) order by item.product_name)
        from public.checkout_session_items item
        where item.checkout_session_id = p_checkout_session_id
      ), '[]'::jsonb)
    )
  );

  return created_order_id;
end;
$$;

revoke all on function public.reclaim_checkout_for_capture(uuid) from public, anon, authenticated;
grant execute on function public.reclaim_checkout_for_capture(uuid) to service_role;
