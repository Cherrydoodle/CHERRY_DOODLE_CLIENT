-- Allows a product variant to be name-only (no color) -- e.g. a book edition or a
-- pack size that has no meaningful swatch. Previously product_variants.color_id was
-- NOT NULL, forcing every variant to borrow an unrelated color just to satisfy the
-- schema. Entirely additive: no existing row's color_id is touched, so every current
-- variant keeps rendering exactly as it does today.

-- 1. Allow a variant to omit its color.
alter table public.product_variants alter column color_id drop not null;

-- 2. product_variants_active_option_idx enforced (product_id, color_id, lower(label))
-- uniqueness, but a btree unique index never considers NULLs equal, so once color_id
-- can be NULL that index silently stops guarding name-only variants at all (two
-- colorless variants with the same label could coexist). Split it into two partial
-- indexes: one for the color case (unchanged behavior), one for the name-only case.
-- Current data already satisfies both by construction, since every existing row has
-- a non-null color_id today.
drop index if exists public.product_variants_active_option_idx;

create unique index product_variants_active_color_option_idx
  on public.product_variants (product_id, color_id, lower(label))
  where deleted_at is null and color_id is not null;

create unique index product_variants_active_name_option_idx
  on public.product_variants (product_id, lower(label))
  where deleted_at is null and color_id is null;

-- 3. public_product_cards: CREATE OR REPLACE VIEW may only append columns or change
-- column expressions, never drop/reorder/retype existing ones (see the header comment
-- in 202607250003_public_product_cards_offers.sql). This changes only the variants
-- lateral's join and two expressions -- every other column and join is reproduced
-- byte-for-byte from 202607260003_public_product_cards_gallery.sql:
--   * `join public.colors` -> `left join public.colors`, so a colorless variant no
--     longer drops its whole product out of the lateral (and therefore the storefront)
--   * color-derived jsonb fields (`id`, `name`, `slug`, `hex`) become null for a
--     colorless variant instead of erroring
--   * `array_agg(c.slug ...)` -> wrapped in `array_remove(..., null)` so the
--     color-facet filters on /category, /collections/all and /offers never see a
--     null member in color_slugs
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
  offer.offer_ends_at,
  gallery.card_media
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
    ) order by v.sort_order, coalesce(c.sort_order, 0), v.id) as colors,
    array_remove(array_agg(c.slug order by v.sort_order, coalesce(c.sort_order, 0), v.id), null) as color_slugs,
    case
      when sum(v.stock_quantity) = 0 then 'out_of_stock'
      when sum(v.stock_quantity) <= sum(v.low_stock_threshold) then 'low_stock'
      else 'in_stock'
    end as availability
  from public.product_variants v
  left join public.colors c on c.id = v.color_id and c.deleted_at is null
  where v.product_id = p.id and v.is_active and v.deleted_at is null
  having count(*) > 0
) variants on true
left join lateral (
  select coalesce(array_agg(pb.badge::text order by pb.badge::text), array[]::text[]) as badges
  from public.product_badges pb where pb.product_id = p.id
) badges on true
left join public.active_product_offers offer on offer.product_id = p.id
left join lateral (
  select coalesce(jsonb_agg(item order by item_primary desc, item_position), '[]'::jsonb) as card_media
  from (
    select
      jsonb_build_object(
        'id', ma.id,
        'storageKey', ma.storage_key,
        'alt', coalesce(pm.alt_text_override, ma.alt_text),
        'width', ma.width,
        'height', ma.height
      ) as item,
      pm.is_primary as item_primary,
      pm.position as item_position
    from public.product_media pm
    join public.media_assets ma on ma.id = pm.media_asset_id
    where pm.product_id = p.id and ma.status = 'ready' and ma.deleted_at is null
    order by pm.is_primary desc, pm.position
    limit 4
  ) ranked
) gallery on true
where p.status = 'published'
  and p.deleted_at is null
  and p.published_at <= now()
  and subcategory.is_active and subcategory.deleted_at is null
  and (parent.id is null or (parent.is_active and parent.deleted_at is null));

grant select on public.public_product_cards to anon, authenticated;

comment on view public.public_product_cards is 'Safe public product projection. Provider URLs are constructed in the application DTO mapper. effective_price_cents prefers a live offer price over the manual sale price. colors[].label distinguishes same-color variants (e.g. different book covers in the same palette); a name-only variant has null id/name/slug/hex. card_media holds up to 4 ready product images (primary first) for the storefront card''s rotating image view.';
