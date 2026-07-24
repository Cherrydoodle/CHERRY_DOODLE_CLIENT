-- RZ-060: Refund & return workflow.
-- Adds an independent return-lifecycle to orders (does not touch the existing
-- fulfilment status enum/values), a refunds table modelled after payment_attempts,
-- and service-role RPCs mirroring complete_razorpay_checkout's row-locked,
-- single-transaction style. The existing payment engine (order creation, /verify,
-- webhook signature handling) is not modified; transition_order_status is extended
-- (not rewritten) to fix the audited "cancel does not restock" gap (H4).

do $$ begin
  create type public.order_return_status as enum ('none', 'requested', 'approved', 'rejected', 'returned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.refund_status as enum ('created', 'processed', 'failed');
exception when duplicate_object then null; end $$;

alter table public.orders
  add column if not exists return_status public.order_return_status not null default 'none',
  add column if not exists return_reason varchar(500),
  add column if not exists return_requested_at timestamptz,
  add column if not exists return_resolved_at timestamptz,
  add column if not exists return_resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists return_resolution_note varchar(500),
  add column if not exists returned_at timestamptz,
  -- Guards restock idempotency across both the cancellation path and the return
  -- path, so a retried request or a re-run transition can never double-restock.
  add column if not exists stock_restored_at timestamptz;

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_attempt_id uuid not null references public.payment_attempts(id) on delete restrict,
  razorpay_refund_id varchar(100) unique,
  amount_minor integer not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status public.refund_status not null default 'created',
  reason varchar(500) not null check (char_length(trim(reason)) between 1 and 500),
  initiated_by uuid not null references auth.users(id) on delete restrict,
  error_description varchar(1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists refunds_order_idx on public.refunds(order_id, created_at desc);
create index if not exists refunds_payment_attempt_idx on public.refunds(payment_attempt_id, status);

drop trigger if exists refunds_touch_updated_at on public.refunds;
create trigger refunds_touch_updated_at before update on public.refunds
for each row execute function public.touch_updated_at();

-- Extends the existing state machine: adds the cancellation-restock fix (H4) as a
-- new branch. All prior transitions/validation are unchanged.
create or replace function public.transition_order_status(
  p_order_id uuid,
  p_expected_version integer,
  p_new_status public.order_status,
  p_actor_id uuid,
  p_reason varchar default null
)
returns public.orders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_order public.orders;
  updated_order public.orders;
begin
  select * into current_order from public.orders where id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if current_order.status = p_new_status then return current_order; end if;
  if not (
    (current_order.status = 'pending' and p_new_status in ('processing', 'cancelled')) or
    (current_order.status = 'processing' and p_new_status in ('shipped', 'cancelled')) or
    (current_order.status = 'shipped' and p_new_status = 'delivered')
  ) then raise exception 'INVALID_ORDER_TRANSITION'; end if;

  update public.orders set
    status = p_new_status,
    fulfilled_at = case when p_new_status = 'delivered' then now() else fulfilled_at end,
    cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end,
    updated_by = p_actor_id
  where id = p_order_id and version = p_expected_version
  returning * into updated_order;

  insert into public.order_status_history(order_id, from_status, to_status, reason, changed_by)
  values (p_order_id, current_order.status, p_new_status, p_reason, p_actor_id);

  if p_new_status = 'cancelled' and current_order.stock_restored_at is null then
    update public.product_variants variant
    set stock_quantity = variant.stock_quantity + item.quantity
    from public.order_items item
    where item.order_id = p_order_id and variant.id = item.product_variant_id;

    update public.orders set stock_restored_at = now() where id = p_order_id;
    select * into updated_order from public.orders where id = p_order_id;
  end if;

  return updated_order;
end;
$$;

-- Customer requests a return on a delivered order they own. Only one open request
-- per order (return_status must be 'none').
create or replace function public.request_order_return(
  p_order_id uuid,
  p_customer_id uuid,
  p_reason varchar
)
returns public.orders
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  order_record public.orders;
begin
  select * into order_record from public.orders
  where id = p_order_id and customer_user_id = p_customer_id and deleted_at is null
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if order_record.status <> 'delivered' then raise exception 'ORDER_NOT_DELIVERED'; end if;
  if order_record.return_status <> 'none' then raise exception 'RETURN_ALREADY_REQUESTED'; end if;

  update public.orders set
    return_status = 'requested',
    return_reason = p_reason,
    return_requested_at = now()
  where id = p_order_id
  returning * into order_record;
  return order_record;
end;
$$;

-- Admin approves or rejects an open return request.
create or replace function public.resolve_order_return(
  p_order_id uuid,
  p_decision public.order_return_status,
  p_actor_id uuid,
  p_note varchar default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  order_record public.orders;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_RETURN_DECISION'; end if;

  select * into order_record from public.orders where id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if order_record.return_status <> 'requested' then raise exception 'RETURN_NOT_PENDING'; end if;

  update public.orders set
    return_status = p_decision,
    return_resolved_at = now(),
    return_resolved_by = p_actor_id,
    return_resolution_note = p_note
  where id = p_order_id
  returning * into order_record;
  return order_record;
end;
$$;

-- Admin marks an approved return as physically received. This is where stock is
-- restored for the return path (decision: refund follows within 2 business days
-- of receiving the item, so restock happens at receipt, not at approval).
create or replace function public.mark_order_returned(
  p_order_id uuid,
  p_actor_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  order_record public.orders;
begin
  select * into order_record from public.orders where id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if order_record.return_status <> 'approved' then raise exception 'RETURN_NOT_APPROVED'; end if;

  update public.orders set return_status = 'returned', returned_at = now() where id = p_order_id;

  if order_record.stock_restored_at is null then
    update public.product_variants variant
    set stock_quantity = variant.stock_quantity + item.quantity
    from public.order_items item
    where item.order_id = p_order_id and variant.id = item.product_variant_id;

    update public.orders set stock_restored_at = now() where id = p_order_id;
  end if;

  select * into order_record from public.orders where id = p_order_id;
  return order_record;
end;
$$;

-- Reserves a refund amount against a captured payment. Row-locks the payment
-- attempt so concurrent refund requests cannot together exceed the captured
-- amount; 'created' and 'processed' refunds both count against the cap ('failed'
-- refunds do not, so a failed attempt never blocks a legitimate retry).
create or replace function public.create_refund_record(
  p_order_id uuid,
  p_payment_attempt_id uuid,
  p_amount_minor integer,
  p_reason varchar,
  p_initiated_by uuid
)
returns public.refunds
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  payment_attempt_record public.payment_attempts;
  already_reserved integer;
  new_refund public.refunds;
begin
  if p_amount_minor <= 0 then raise exception 'REFUND_AMOUNT_INVALID'; end if;

  select pa.* into payment_attempt_record
  from public.payment_attempts pa
  join public.checkout_sessions cs on cs.id = pa.checkout_session_id
  where pa.id = p_payment_attempt_id and cs.order_id = p_order_id
  for update;
  if not found then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  -- A payment attempt already fully refunded is 'refunded', not 'captured'; the
  -- amount-sum check below is what actually blocks over-refund, but requiring
  -- 'captured' here gives a clearer failure for the common "already fully
  -- refunded" case without relying solely on the arithmetic guard.
  if payment_attempt_record.status <> 'captured' then raise exception 'PAYMENT_NOT_CAPTURED'; end if;

  select coalesce(sum(amount_minor), 0) into already_reserved
  from public.refunds
  where payment_attempt_id = p_payment_attempt_id and status in ('created', 'processed');

  if already_reserved + p_amount_minor > payment_attempt_record.amount_minor then
    raise exception 'REFUND_EXCEEDS_CAPTURED';
  end if;

  insert into public.refunds (order_id, payment_attempt_id, amount_minor, currency, reason, initiated_by)
  values (p_order_id, p_payment_attempt_id, p_amount_minor, payment_attempt_record.currency, p_reason, p_initiated_by)
  returning * into new_refund;
  return new_refund;
end;
$$;

-- Idempotent status sync, called both right after the synchronous Razorpay refund
-- call and from the refund.* webhook (recovery path if the process crashes
-- in between). Once a refund leaves 'created' it is terminal; repeat calls no-op.
create or replace function public.mark_refund_processed(
  p_razorpay_refund_id varchar,
  p_status public.refund_status,
  p_error_description varchar default null
)
returns public.refunds
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  refund_record public.refunds;
  payment_attempt_record public.payment_attempts;
  total_processed integer;
begin
  select * into refund_record from public.refunds where razorpay_refund_id = p_razorpay_refund_id for update;
  if not found then raise exception 'REFUND_NOT_FOUND'; end if;
  if refund_record.status <> 'created' then return refund_record; end if;

  update public.refunds
  set status = p_status, error_description = coalesce(p_error_description, error_description)
  where id = refund_record.id
  returning * into refund_record;

  if p_status = 'processed' then
    select * into payment_attempt_record from public.payment_attempts where id = refund_record.payment_attempt_id for update;

    select coalesce(sum(amount_minor), 0) into total_processed
    from public.refunds
    where payment_attempt_id = refund_record.payment_attempt_id and status = 'processed';

    update public.orders
    set payment_status = case
      when total_processed >= payment_attempt_record.amount_minor then 'refunded'
      else 'partially_refunded'
    end
    where id = refund_record.order_id;

    if total_processed >= payment_attempt_record.amount_minor then
      update public.payment_attempts set status = 'refunded' where id = payment_attempt_record.id;
    end if;
  end if;

  return refund_record;
end;
$$;

alter table public.refunds enable row level security;

create policy refunds_select_own on public.refunds for select to authenticated
using (exists (
  select 1 from public.orders o where o.id = order_id and o.deleted_at is null
  and (o.customer_user_id = (select auth.uid()) or (select public.authorize('orders.read')))
));

grant select on public.refunds to authenticated;
revoke all on function public.request_order_return(uuid, uuid, varchar) from public, anon, authenticated;
revoke all on function public.resolve_order_return(uuid, public.order_return_status, uuid, varchar) from public, anon, authenticated;
revoke all on function public.mark_order_returned(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_refund_record(uuid, uuid, integer, varchar, uuid) from public, anon, authenticated;
revoke all on function public.mark_refund_processed(varchar, public.refund_status, varchar) from public, anon, authenticated;
grant execute on function public.request_order_return(uuid, uuid, varchar) to service_role;
grant execute on function public.resolve_order_return(uuid, public.order_return_status, uuid, varchar) to service_role;
grant execute on function public.mark_order_returned(uuid, uuid) to service_role;
grant execute on function public.create_refund_record(uuid, uuid, integer, varchar, uuid) to service_role;
grant execute on function public.mark_refund_processed(varchar, public.refund_status, varchar) to service_role;
