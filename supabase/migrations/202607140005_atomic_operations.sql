do $$ begin
  create type public.email_delivery_status as enum ('pending', 'processing', 'sent', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  message_type text not null,
  recipient_email extensions.citext not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status public.email_delivery_status not null default 'pending',
  attempts smallint not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.email_outbox enable row level security;
create index if not exists email_outbox_pending_idx on public.email_outbox(status, next_attempt_at) where status in ('pending', 'failed');

create or replace function public.cart_add_item_atomic(
  p_cart_id uuid,
  p_variant_id uuid,
  p_quantity smallint
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allowed_quantity smallint;
  item_id uuid;
begin
  if p_quantity < 1 or p_quantity > 99 then raise exception 'INVALID_QUANTITY'; end if;

  select least(p_quantity::integer, v.stock_quantity, 99)::smallint into allowed_quantity
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant_id and v.is_active and v.deleted_at is null
    and p.status = 'published' and p.deleted_at is null and p.published_at <= now();

  if allowed_quantity is null or allowed_quantity < 1 then raise exception 'VARIANT_UNAVAILABLE'; end if;

  insert into public.cart_items (cart_id, product_variant_id, quantity)
  values (p_cart_id, p_variant_id, allowed_quantity)
  on conflict (cart_id, product_variant_id) do update
    set quantity = least(
      99,
      public.cart_items.quantity + excluded.quantity,
      (select stock_quantity from public.product_variants where id = p_variant_id)
    )::smallint,
    updated_at = now()
  returning id into item_id;

  update public.carts set updated_at = now(), expires_at = case when guest_token_hash is not null then now() + interval '30 days' else expires_at end
  where id = p_cart_id and status = 'active';
  return item_id;
end;
$$;

create or replace function public.cart_set_item_quantity_atomic(
  p_cart_id uuid,
  p_item_id uuid,
  p_quantity smallint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare available_stock integer;
begin
  if p_quantity < 1 or p_quantity > 99 then raise exception 'INVALID_QUANTITY'; end if;
  select v.stock_quantity into available_stock
  from public.cart_items ci
  join public.product_variants v on v.id = ci.product_variant_id
  join public.products p on p.id = v.product_id
  where ci.id = p_item_id and ci.cart_id = p_cart_id and v.is_active and v.deleted_at is null
    and p.status = 'published' and p.deleted_at is null;
  if available_stock is null or available_stock < 1 then raise exception 'VARIANT_UNAVAILABLE'; end if;
  update public.cart_items set quantity = least(p_quantity::integer, available_stock, 99)::smallint
  where id = p_item_id and cart_id = p_cart_id;
  if not found then raise exception 'CART_ITEM_NOT_FOUND'; end if;
  update public.carts set updated_at = now() where id = p_cart_id;
end;
$$;

create or replace function public.claim_guest_cart_atomic(p_user_id uuid, p_guest_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_cart_id uuid;
  guest_cart_id uuid;
begin
  insert into public.carts (user_id, status)
  values (p_user_id, 'active')
  on conflict (user_id) where status = 'active' and user_id is not null do nothing;

  select id into target_cart_id from public.carts
  where user_id = p_user_id and status = 'active'
  for update;

  select id into guest_cart_id from public.carts
  where guest_token_hash = p_guest_hash and status = 'active'
  for update;

  if guest_cart_id is null then return target_cart_id; end if;

  insert into public.cart_items (cart_id, product_variant_id, quantity)
  select target_cart_id, source.product_variant_id,
    least(source.quantity::integer, variant.stock_quantity, 99)::smallint
  from public.cart_items source
  join public.product_variants variant on variant.id = source.product_variant_id
  join public.products product on product.id = variant.product_id
  where source.cart_id = guest_cart_id and variant.is_active and variant.deleted_at is null
    and variant.stock_quantity > 0 and product.status = 'published' and product.deleted_at is null
  on conflict (cart_id, product_variant_id) do update
    set quantity = least(
      99,
      public.cart_items.quantity + excluded.quantity,
      (select stock_quantity from public.product_variants where id = excluded.product_variant_id)
    )::smallint,
    updated_at = now();

  update public.carts set status = 'merged', merged_into_cart_id = target_cart_id, guest_token_hash = null, updated_at = now()
  where id = guest_cart_id;
  update public.carts set updated_at = now() where id = target_cart_id;
  return target_cart_id;
end;
$$;

revoke execute on function public.cart_add_item_atomic(uuid, uuid, smallint) from public, anon, authenticated;
revoke execute on function public.cart_set_item_quantity_atomic(uuid, uuid, smallint) from public, anon, authenticated;
revoke execute on function public.claim_guest_cart_atomic(uuid, text) from public, anon, authenticated;
grant execute on function public.cart_add_item_atomic(uuid, uuid, smallint) to service_role;
grant execute on function public.cart_set_item_quantity_atomic(uuid, uuid, smallint) to service_role;
grant execute on function public.claim_guest_cart_atomic(uuid, text) to service_role;
