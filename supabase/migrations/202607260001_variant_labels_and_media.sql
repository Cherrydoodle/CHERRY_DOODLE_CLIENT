-- Adds a text label to product variants so two variants can share a color (e.g. three
-- book covers that all use the same "Cherry" color palette but are different titles).
-- Previously product_variants_active_color_idx made (product_id, color_id) unique,
-- which physically forbade this. Also adds product_variant_media so each variant can
-- point at a subset of the product's existing gallery images, and adds nullable
-- variant_label/color_name snapshot columns to order_items/checkout_session_items so
-- an order permanently records which variant was bought, independent of the mutable
-- product_variants row.
--
-- Entirely additive/reversible: every new column is nullable-then-backfilled before
-- any NOT NULL constraint, and the order/checkout snapshot columns stay nullable
-- forever so historical rows are never rejected. See supabase/MIGRATION.md.

-- 1. Add label, backfill from the variant's current color name, then require it.
alter table public.product_variants add column if not exists label varchar(100);

update public.product_variants v
set label = c.name
from public.colors c
where c.id = v.color_id and v.label is null;

alter table public.product_variants alter column label set not null;
alter table public.product_variants add constraint product_variants_label_len check (char_length(label) between 1 and 100);

-- 2. Relax the color-only uniqueness to (color, label). The backfill above guarantees
-- no two currently-active variants collide under the new index, since the old index
-- already forbade duplicate colors outright.
drop index if exists public.product_variants_active_color_idx;
create unique index product_variants_active_option_idx
  on public.product_variants (product_id, color_id, lower(label))
  where deleted_at is null;

-- 3. Per-variant image selection, drawn from the product's existing gallery
-- (product_media) -- no separate upload path, matches product_media's own shape.
create table if not exists public.product_variant_media (
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete restrict,
  position smallint not null check (position between 0 and 99),
  created_at timestamptz not null default now(),
  primary key (product_variant_id, media_asset_id)
);
create unique index if not exists product_variant_media_position_idx
  on public.product_variant_media (product_variant_id, position);

alter table public.product_variant_media enable row level security;

create policy product_variant_media_public_select on public.product_variant_media for select to anon, authenticated
using (exists (
  select 1 from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = product_variant_id and p.status = 'published' and p.deleted_at is null and p.published_at <= now()
));
create policy product_variant_media_admin_all on public.product_variant_media for all to authenticated
using ((select public.authorize('media.write')))
with check ((select public.authorize('media.write')));

grant select on public.product_variant_media to anon, authenticated;
grant select, insert, update, delete on public.product_variant_media to authenticated;

-- 4. Immutable order-time snapshot of which variant was bought. Nullable forever:
-- pre-existing order_items/checkout_session_items rows keep null and every read path
-- falls back to the sku column, which is the only trace they have today.
alter table public.order_items add column if not exists variant_label varchar(100);
alter table public.order_items add column if not exists color_name varchar(80);
alter table public.checkout_session_items add column if not exists variant_label varchar(100);
alter table public.checkout_session_items add column if not exists color_name varchar(80);

-- 5. create_product_with_variant needs a new trailing parameter. CREATE OR REPLACE
-- cannot change a function's parameter list without creating an ambiguous overload,
-- so the old signature is dropped and the new one created in the same transaction.
drop function if exists public.create_product_with_variant(
  text, varchar, varchar, text, varchar, varchar, integer, integer, integer, boolean,
  uuid, public.product_badge[], uuid, text, integer, integer, uuid, uuid
);

create function public.create_product_with_variant(
  p_slug text,
  p_name varchar,
  p_label varchar,
  p_description text,
  p_material varchar,
  p_size varchar,
  p_base_price_cents integer,
  p_sale_price_cents integer,
  p_featured_sort_order integer,
  p_allow_custom_image boolean,
  p_primary_category_id uuid,
  p_badges public.product_badge[],
  p_color_id uuid,
  p_variant_label varchar,
  p_sku text,
  p_stock_quantity integer,
  p_low_stock_threshold integer,
  p_media_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  insert into public.products (
    slug, name, label, description, material, size, base_price_cents, sale_price_cents,
    featured_sort_order, allow_custom_image, status, created_by, updated_by
  ) values (
    p_slug, p_name, p_label, p_description, p_material, p_size, p_base_price_cents, p_sale_price_cents,
    p_featured_sort_order, p_allow_custom_image, 'draft', p_actor_id, p_actor_id
  ) returning id into v_product_id;

  insert into public.product_categories (product_id, category_id, is_primary)
  values (v_product_id, p_primary_category_id, true);

  if p_badges is not null and array_length(p_badges, 1) > 0 then
    insert into public.product_badges (product_id, badge, assigned_by)
    select v_product_id, badge, p_actor_id from unnest(p_badges) as badge;
  end if;

  insert into public.product_variants (product_id, color_id, label, sku, stock_quantity, low_stock_threshold)
  values (v_product_id, p_color_id, p_variant_label, p_sku, p_stock_quantity, p_low_stock_threshold);

  if p_media_id is not null then
    insert into public.product_media (product_id, media_asset_id, position, is_primary)
    values (v_product_id, p_media_id, 0, true);
  end if;

  return v_product_id;
end;
$$;

revoke all on function public.create_product_with_variant(
  text, varchar, varchar, text, varchar, varchar, integer, integer, integer, boolean,
  uuid, public.product_badge[], uuid, varchar, text, integer, integer, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_product_with_variant(
  text, varchar, varchar, text, varchar, varchar, integer, integer, integer, boolean,
  uuid, public.product_badge[], uuid, varchar, text, integer, integer, uuid, uuid
) to service_role;

-- 6. complete_razorpay_checkout: unchanged from 202607240002_payment_reliability.sql
-- except the order_items insert now carries the variant_label/color_name snapshot
-- across from checkout_session_items.
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
    order_id, product_id, product_variant_id, product_name, sku, variant_label, color_name,
    quantity, unit_price_minor, line_total_minor
  )
  select created_order_id, product_id, product_variant_id, product_name, sku, variant_label, color_name,
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

revoke all on function public.complete_razorpay_checkout(uuid, varchar, varchar, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_razorpay_checkout(uuid, varchar, varchar, timestamptz) to service_role;

-- 7. public_product_cards: CREATE OR REPLACE VIEW may only append columns or change
-- column expressions, never drop/reorder/retype existing ones (see the header comment
-- in 202607250003_public_product_cards_offers.sql). This changes only the `variants`
-- lateral's jsonb_build_object to add 'label'; every other column is reproduced
-- byte-for-byte from that migration.
create or replace view public.public_product_cards
with (security_invoker = true)
as
select
  p.id,
  p.slug,
  p.name,
  p.label,
  p.description,
  p.material,
  p.size,
  p.base_price_cents,
  p.sale_price_cents,
  coalesce(offer.offer_price_cents, p.sale_price_cents, p.base_price_cents) as effective_price_cents,
  p.currency,
  p.aggregate_rating,
  p.review_count,
  p.published_at,
  p.featured_sort_order,
  p.search_document,
  image.media_id,
  image.storage_key,
  image.alt_text,
  image.width,
  image.height,
  variants.colors,
  variants.color_slugs,
  variants.availability,
  badges.badges,
  subcategory.id as category_id,
  subcategory.slug as subcategory_slug,
  subcategory.name as subcategory_name,
  coalesce(parent.id, subcategory.id) as top_category_id,
  coalesce(parent.slug, subcategory.slug) as top_category_slug,
  coalesce(parent.name, subcategory.name) as top_category_name,
  offer.offer_id,
  offer.offer_name,
  offer.offer_slug,
  offer.offer_discount_percent,
  offer.offer_price_cents,
  offer.offer_ends_at
from public.products p
join public.product_categories pc on pc.product_id = p.id and pc.is_primary
join public.categories subcategory on subcategory.id = pc.category_id
left join public.categories parent on parent.id = subcategory.parent_id
join lateral (
  select
    ma.id as media_id,
    ma.storage_key,
    coalesce(pm.alt_text_override, ma.alt_text) as alt_text,
    ma.width,
    ma.height
  from public.product_media pm
  join public.media_assets ma on ma.id = pm.media_asset_id
  where pm.product_id = p.id and pm.is_primary and ma.status = 'ready' and ma.deleted_at is null
  order by pm.position
  limit 1
) image on true
join lateral (
  select
    jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name::text,
      'slug', c.slug,
      'hex', c.hex_code,
      'variantId', v.id,
      'label', v.label,
      'sku', v.sku::text,
      'stockQuantity', v.stock_quantity,
      'lowStockThreshold', v.low_stock_threshold
    ) order by v.sort_order, c.sort_order, v.id) as colors,
    array_agg(c.slug order by v.sort_order, c.sort_order) as color_slugs,
    case
      when sum(v.stock_quantity) = 0 then 'out_of_stock'
      when sum(v.stock_quantity) <= sum(v.low_stock_threshold) then 'low_stock'
      else 'in_stock'
    end as availability
  from public.product_variants v
  join public.colors c on c.id = v.color_id and c.deleted_at is null
  where v.product_id = p.id and v.is_active and v.deleted_at is null
  having count(*) > 0
) variants on true
left join lateral (
  select coalesce(array_agg(pb.badge::text order by pb.badge::text), array[]::text[]) as badges
  from public.product_badges pb where pb.product_id = p.id
) badges on true
left join public.active_product_offers offer on offer.product_id = p.id
where p.status = 'published'
  and p.deleted_at is null
  and p.published_at <= now()
  and subcategory.is_active and subcategory.deleted_at is null
  and (parent.id is null or (parent.is_active and parent.deleted_at is null));

grant select on public.public_product_cards to anon, authenticated;

comment on view public.public_product_cards is 'Safe public product projection. Provider URLs are constructed in the application DTO mapper. effective_price_cents prefers a live offer price over the manual sale price. colors[].label distinguishes same-color variants (e.g. different book covers in the same palette).';
