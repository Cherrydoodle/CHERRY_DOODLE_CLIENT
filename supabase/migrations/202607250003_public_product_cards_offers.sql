-- CREATE OR REPLACE VIEW may only append columns and change column expressions; it
-- cannot drop, rename, retype, or reorder existing ones. This migration does only
-- those two permitted things to public.public_product_cards:
--   1. Redefines effective_price_cents to prefer a live offer price over the
--      manual sale price, so sort=price-asc/desc and the priceMaxCents filter
--      respect offers automatically. Every other existing column is unchanged.
--   2. Appends offer_id/offer_name/offer_slug/offer_discount_percent/
--      offer_price_cents/offer_ends_at at the end.
-- The base products/categories/media/variants/badges joins are reproduced
-- byte-for-byte from 202607140004_views_rls.sql (as renamed by
-- 202607150004_r2_object_storage.sql: cloudflare_image_id -> storage_key).
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

comment on view public.public_product_cards is 'Safe public product projection. Provider URLs are constructed in the application DTO mapper. effective_price_cents prefers a live offer price over the manual sale price.';
