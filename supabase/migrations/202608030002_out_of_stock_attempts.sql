-- Out-of-stock flow: distinguishes "sold out" from "not purchasable" at add-to-cart
-- time, logs every rejected sold-out attempt, and exposes an aggregated admin view.
-- Entirely additive: a new table, a new function, a new view, and a signature-
-- compatible replacement of cart_add_item_atomic (same params/return type).

-- 1. cart_add_item_atomic previously collapsed two different failures into one
-- VARIANT_UNAVAILABLE code: a variant that is inactive/unpublished/deleted, and a
-- variant that simply has zero stock. The storefront needs to tell these apart --
-- only the second is "out of stock" and worth logging as a sold-out attempt.
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
  v_stock integer;
  allowed_quantity smallint;
  item_id uuid;
begin
  if p_quantity < 1 or p_quantity > 99 then raise exception 'INVALID_QUANTITY'; end if;

  select v.stock_quantity into v_stock
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant_id and v.is_active and v.deleted_at is null
    and p.status = 'published' and p.deleted_at is null and p.published_at <= now();

  if v_stock is null then raise exception 'VARIANT_UNAVAILABLE'; end if;
  if v_stock <= 0 then raise exception 'OUT_OF_STOCK'; end if;
  allowed_quantity := least(p_quantity::integer, v_stock, 99)::smallint;

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

-- 2. One row per rejected sold-out attempt. No RLS policies/grants to anon or
-- authenticated: both the write (from the failed add-to-cart path) and the read
-- (admin listing) go through the service-role client, which bypasses RLS entirely.
-- actor_user_id is null for guests -- counts are the requirement, and a guest hash
-- would add pseudo-PII for no analytical gain.
create table if not exists public.out_of_stock_attempts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  requested_quantity smallint not null check (requested_quantity between 1 and 99),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists out_of_stock_attempts_variant_idx on public.out_of_stock_attempts (product_variant_id, created_at desc);
alter table public.out_of_stock_attempts enable row level security;

-- 3. Logging is a separate RPC, not inlined into cart_add_item_atomic: that function's
-- `raise exception` rolls back its own transaction, so anything inserted before the
-- raise would be discarded along with it. The caller invokes this only after catching
-- the OUT_OF_STOCK error, in its own transaction.
create or replace function public.log_out_of_stock_attempt(
  p_variant_id uuid,
  p_quantity smallint,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  select product_id into v_product_id from public.product_variants where id = p_variant_id;
  if v_product_id is null then return; end if;
  insert into public.out_of_stock_attempts (product_id, product_variant_id, requested_quantity, actor_user_id)
  values (v_product_id, p_variant_id, p_quantity, p_actor_id);
end;
$$;

revoke execute on function public.log_out_of_stock_attempt(uuid, smallint, uuid) from public, anon, authenticated;
grant execute on function public.log_out_of_stock_attempt(uuid, smallint, uuid) to service_role;

-- 4. One row per currently out-of-stock active variant, with attempt counts
-- pre-aggregated (PostgREST callers cannot express GROUP BY). No grant to
-- anon/authenticated -- the admin panel reads this exclusively through the
-- service-role client via the backend's admin API.
create or replace view public.admin_out_of_stock_variants
with (security_invoker = true)
as
select
  v.id as variant_id,
  v.sku,
  v.label,
  v.sort_order,
  c.id as color_id,
  c.name::text as color_name,
  c.hex_code as color_hex,
  p.id as product_id,
  p.name as product_name,
  p.slug as product_slug,
  p.status as product_status,
  coalesce(a.attempt_count, 0) as attempt_count,
  coalesce(a.attempts_last_7d, 0) as attempts_last_7d,
  a.last_attempted_at
from public.product_variants v
join public.products p on p.id = v.product_id and p.deleted_at is null
left join public.colors c on c.id = v.color_id and c.deleted_at is null
left join lateral (
  select
    count(*) as attempt_count,
    count(*) filter (where created_at >= now() - interval '7 days') as attempts_last_7d,
    max(created_at) as last_attempted_at
  from public.out_of_stock_attempts oa where oa.product_variant_id = v.id
) a on true
where v.stock_quantity = 0 and v.is_active and v.deleted_at is null;

comment on view public.admin_out_of_stock_variants is 'Admin-only: one row per currently out-of-stock active variant, with add-to-cart attempt counts. Read exclusively via the service-role client.';
