do $$ begin
  create type public.checkout_session_status as enum (
    'creating_payment', 'payment_pending', 'completed', 'failed', 'expired', 'requires_review'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.inventory_reservation_status as enum ('active', 'converted', 'released', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_payment_status as enum ('pending', 'paid', 'failed', 'partially_refunded', 'refunded');
exception when duplicate_object then null; end $$;

alter table public.orders
  add column if not exists payment_status public.order_payment_status not null default 'pending',
  add column if not exists paid_at timestamptz;

create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  cart_id uuid references public.carts(id) on delete set null,
  guest_token_hash char(64) not null,
  status public.checkout_session_status not null default 'creating_payment',
  customer_name varchar(120) not null,
  customer_email extensions.citext not null,
  customer_phone varchar(32) not null,
  shipping_address jsonb not null check (jsonb_typeof(shipping_address) = 'object'),
  customer_note text check (customer_note is null or char_length(customer_note) <= 2000),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor integer not null check (subtotal_minor >= 0),
  discount_minor integer not null default 0 check (discount_minor >= 0),
  shipping_minor integer not null default 0 check (shipping_minor >= 0),
  tax_minor integer not null default 0 check (tax_minor >= 0),
  total_minor integer not null check (total_minor > 0),
  razorpay_order_id varchar(100) unique,
  razorpay_payment_id varchar(100) unique,
  order_id uuid unique references public.orders(id) on delete set null,
  reservation_expires_at timestamptz not null,
  completed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_minor = subtotal_minor - discount_minor + shipping_minor + tax_minor),
  check (status <> 'completed' or (order_id is not null and completed_at is not null))
);

create table if not exists public.checkout_session_items (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name varchar(200) not null,
  sku varchar(80) not null,
  quantity smallint not null check (quantity between 1 and 99),
  list_unit_price_minor integer not null check (list_unit_price_minor > 0),
  unit_price_minor integer not null check (unit_price_minor > 0),
  line_total_minor integer not null check (line_total_minor > 0),
  created_at timestamptz not null default now(),
  unique (checkout_session_id, product_variant_id),
  check (unit_price_minor <= list_unit_price_minor),
  check (line_total_minor = unit_price_minor * quantity)
);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity smallint not null check (quantity between 1 and 99),
  status public.inventory_reservation_status not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (checkout_session_id, product_variant_id)
);

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  provider varchar(30) not null check (provider = 'razorpay'),
  provider_order_id varchar(100) not null,
  provider_payment_id varchar(100),
  status varchar(30) not null check (status in ('created', 'authorized', 'captured', 'failed', 'refunded')),
  amount_minor integer not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  method varchar(40),
  error_code varchar(100),
  error_description varchar(1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payment_attempts_provider_payment_idx
  on public.payment_attempts(provider, provider_payment_id);
create index if not exists checkout_sessions_status_expiry_idx
  on public.checkout_sessions(status, reservation_expires_at)
  where status in ('creating_payment', 'payment_pending');
create index if not exists checkout_sessions_user_created_idx
  on public.checkout_sessions(user_id, created_at desc) where user_id is not null;
create index if not exists checkout_items_session_idx
  on public.checkout_session_items(checkout_session_id);
create index if not exists inventory_reservations_variant_active_idx
  on public.inventory_reservations(product_variant_id, expires_at) where status = 'active';
create index if not exists inventory_reservations_session_idx
  on public.inventory_reservations(checkout_session_id);
create index if not exists payment_attempts_session_idx
  on public.payment_attempts(checkout_session_id, created_at desc);

drop trigger if exists checkout_sessions_touch_updated_at on public.checkout_sessions;
create trigger checkout_sessions_touch_updated_at before update on public.checkout_sessions
for each row execute function public.touch_updated_at();
drop trigger if exists checkout_sessions_increment_version on public.checkout_sessions;
create trigger checkout_sessions_increment_version before update on public.checkout_sessions
for each row execute function public.increment_version();
drop trigger if exists inventory_reservations_touch_updated_at on public.inventory_reservations;
create trigger inventory_reservations_touch_updated_at before update on public.inventory_reservations
for each row execute function public.touch_updated_at();
drop trigger if exists payment_attempts_touch_updated_at on public.payment_attempts;
create trigger payment_attempts_touch_updated_at before update on public.payment_attempts
for each row execute function public.touch_updated_at();

create or replace function public.reserve_checkout_inventory(p_checkout_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  checkout_record public.checkout_sessions;
begin
  select * into checkout_record
  from public.checkout_sessions
  where id = p_checkout_session_id
  for update;

  if not found then raise exception 'CHECKOUT_NOT_FOUND'; end if;
  if checkout_record.status <> 'creating_payment' then raise exception 'CHECKOUT_STATE_INVALID'; end if;
  if not exists (
    select 1 from public.checkout_session_items where checkout_session_id = p_checkout_session_id
  ) then raise exception 'CHECKOUT_EMPTY'; end if;

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
    join public.products product on product.id = item.product_id
    left join lateral (
      select coalesce(sum(reservation.quantity), 0)::integer as reserved_quantity
      from public.inventory_reservations reservation
      where reservation.product_variant_id = variant.id
        and reservation.status = 'active'
        and reservation.expires_at > now()
    ) reserved on true
    where item.checkout_session_id = p_checkout_session_id
      and (
        not variant.is_active or variant.deleted_at is not null or
        product.status <> 'published' or product.deleted_at is not null or
        variant.stock_quantity - reserved.reserved_quantity < item.quantity
      )
  ) then raise exception 'INSUFFICIENT_STOCK'; end if;

  insert into public.inventory_reservations (
    checkout_session_id, product_variant_id, quantity, status, expires_at
  )
  select item.checkout_session_id, item.product_variant_id, item.quantity, 'active', checkout_record.reservation_expires_at
  from public.checkout_session_items item
  where item.checkout_session_id = p_checkout_session_id;
end;
$$;

create or replace function public.release_checkout_inventory(
  p_checkout_session_id uuid,
  p_target_status public.checkout_session_status
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_status public.checkout_session_status;
begin
  if p_target_status not in ('failed', 'expired') then raise exception 'CHECKOUT_STATE_INVALID'; end if;

  select status into current_status
  from public.checkout_sessions
  where id = p_checkout_session_id
  for update;

  if not found then return; end if;
  if current_status in ('completed', 'failed', 'expired') then return; end if;

  update public.inventory_reservations
  set status = case when p_target_status = 'expired' then 'expired' else 'released' end
  where checkout_session_id = p_checkout_session_id and status = 'active';

  update public.checkout_sessions set status = p_target_status
  where id = p_checkout_session_id;
end;
$$;

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

alter table public.checkout_sessions enable row level security;
alter table public.checkout_session_items enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.payment_attempts enable row level security;

revoke all on public.checkout_sessions, public.checkout_session_items,
  public.inventory_reservations, public.payment_attempts from public, anon, authenticated;
revoke all on function public.reserve_checkout_inventory(uuid) from public, anon, authenticated;
revoke all on function public.release_checkout_inventory(uuid, public.checkout_session_status) from public, anon, authenticated;
revoke all on function public.complete_razorpay_checkout(uuid, varchar, varchar, timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_checkout_inventory(uuid) to service_role;
grant execute on function public.release_checkout_inventory(uuid, public.checkout_session_status) to service_role;
grant execute on function public.complete_razorpay_checkout(uuid, varchar, varchar, timestamptz) to service_role;
