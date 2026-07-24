alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.media_assets enable row level security;
alter table public.categories enable row level security;
alter table public.content_blocks enable row level security;
alter table public.products enable row level security;
alter table public.product_categories enable row level security;
alter table public.colors enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_media enable row level security;
alter table public.product_badges enable row level security;
alter table public.product_reviews enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.newsletter_subscriptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.webhook_events enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
using ((select auth.uid()) = user_id and deleted_at is null);
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = user_id and deleted_at is null)
with check ((select auth.uid()) = user_id);
create policy profiles_admin_select on public.profiles for select to authenticated
using ((select public.authorize('users.manage_roles')));

create policy user_roles_select_own on public.user_roles for select to authenticated
using ((select auth.uid()) = user_id);
create policy user_roles_admin_all on public.user_roles for all to authenticated
using ((select public.authorize('users.manage_roles')))
with check ((select public.authorize('users.manage_roles')));
create policy user_roles_auth_hook_select on public.user_roles for select to supabase_auth_admin using (true);

create policy categories_public_select on public.categories for select to anon, authenticated
using (is_active and deleted_at is null);
create policy categories_admin_all on public.categories for all to authenticated
using ((select public.authorize('catalog.write')))
with check ((select public.authorize('catalog.write')));

create policy content_blocks_public_select on public.content_blocks for select to anon, authenticated
using (
  is_active and deleted_at is null
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);
create policy content_blocks_admin_all on public.content_blocks for all to authenticated
using ((select public.authorize('content.write')))
with check ((select public.authorize('content.write')));

create policy products_public_select on public.products for select to anon, authenticated
using (status = 'published' and deleted_at is null and published_at <= now());
create policy products_admin_all on public.products for all to authenticated
using ((select public.authorize('catalog.write')))
with check ((select public.authorize('catalog.write')));

create policy product_categories_public_select on public.product_categories for select to anon, authenticated
using (exists (
  select 1 from public.products p
  where p.id = product_id and p.status = 'published' and p.deleted_at is null and p.published_at <= now()
));
create policy product_categories_admin_all on public.product_categories for all to authenticated
using ((select public.authorize('catalog.write')))
with check ((select public.authorize('catalog.write')));

create policy colors_public_select on public.colors for select to anon, authenticated
using (deleted_at is null);
create policy colors_admin_all on public.colors for all to authenticated
using ((select public.authorize('catalog.write')))
with check ((select public.authorize('catalog.write')));

create policy variants_public_select on public.product_variants for select to anon, authenticated
using (
  is_active and deleted_at is null and exists (
    select 1 from public.products p
    where p.id = product_id and p.status = 'published' and p.deleted_at is null and p.published_at <= now()
  )
);
create policy variants_admin_all on public.product_variants for all to authenticated
using ((select public.authorize('catalog.write')))
with check ((select public.authorize('catalog.write')));

create policy media_assets_public_select on public.media_assets for select to anon, authenticated
using (status = 'ready' and deleted_at is null and not require_signed_urls);
create policy media_assets_admin_all on public.media_assets for all to authenticated
using ((select public.authorize('media.write')))
with check ((select public.authorize('media.write')));

create policy product_media_public_select on public.product_media for select to anon, authenticated
using (exists (
  select 1 from public.products p
  where p.id = product_id and p.status = 'published' and p.deleted_at is null and p.published_at <= now()
));
create policy product_media_admin_all on public.product_media for all to authenticated
using ((select public.authorize('media.write')))
with check ((select public.authorize('media.write')));

create policy product_badges_public_select on public.product_badges for select to anon, authenticated
using (exists (
  select 1 from public.products p
  where p.id = product_id and p.status = 'published' and p.deleted_at is null and p.published_at <= now()
));
create policy product_badges_admin_all on public.product_badges for all to authenticated
using ((select public.authorize('catalog.write')))
with check ((select public.authorize('catalog.write')));

create policy product_reviews_public_select on public.product_reviews for select to anon, authenticated
using (status = 'approved' and deleted_at is null);
create policy product_reviews_select_own on public.product_reviews for select to authenticated
using ((select auth.uid()) = user_id);

create policy carts_own_all on public.carts for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id and guest_token_hash is null);
create policy cart_items_own_all on public.cart_items for all to authenticated
using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())))
with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));
create policy wishlist_own_all on public.wishlist_items for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy newsletter_admin_select on public.newsletter_subscriptions for select to authenticated
using ((select public.authorize('newsletter.read')));
create policy audit_admin_select on public.audit_logs for select to authenticated
using ((select public.authorize('audit.read')));

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.categories, public.content_blocks, public.products, public.product_categories,
  public.colors, public.product_variants, public.media_assets, public.product_media,
  public.product_badges, public.product_reviews to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.categories, public.content_blocks, public.products,
  public.product_categories, public.colors, public.product_variants, public.media_assets,
  public.product_media, public.product_badges to authenticated;
grant select, insert, update, delete on public.carts, public.cart_items, public.wishlist_items to authenticated;
grant select on public.newsletter_subscriptions, public.audit_logs to authenticated;

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
  coalesce(p.sale_price_cents, p.base_price_cents) as effective_price_cents,
  p.currency,
  p.aggregate_rating,
  p.review_count,
  p.published_at,
  p.featured_sort_order,
  p.search_document,
  image.media_id,
  image.cloudflare_image_id,
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
  coalesce(parent.name, subcategory.name) as top_category_name
from public.products p
join public.product_categories pc on pc.product_id = p.id and pc.is_primary
join public.categories subcategory on subcategory.id = pc.category_id
left join public.categories parent on parent.id = subcategory.parent_id
join lateral (
  select
    ma.id as media_id,
    ma.cloudflare_image_id,
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
where p.status = 'published'
  and p.deleted_at is null
  and p.published_at <= now()
  and subcategory.is_active and subcategory.deleted_at is null
  and (parent.id is null or (parent.is_active and parent.deleted_at is null));

create or replace view public.public_category_tree
with (security_invoker = true)
as
select
  parent.id,
  parent.slug,
  parent.name,
  parent.description,
  parent.emoji,
  parent.seo_title,
  parent.seo_description,
  parent.sort_order,
  ma.id as media_id,
  ma.cloudflare_image_id,
  ma.alt_text,
  ma.width,
  ma.height,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', child.id, 'slug', child.slug, 'name', child.name) order by child.sort_order, child.name)
    from public.categories child
    where child.parent_id = parent.id and child.is_active and child.deleted_at is null
  ), '[]'::jsonb) as subcategories
from public.categories parent
left join public.media_assets ma on ma.id = parent.image_media_id and ma.status = 'ready' and ma.deleted_at is null
where parent.parent_id is null and parent.is_active and parent.deleted_at is null;

grant select on public.public_product_cards, public.public_category_tree to anon, authenticated;

comment on view public.public_product_cards is 'Safe public product projection. Provider URLs are constructed in the application DTO mapper.';
comment on view public.public_category_tree is 'Safe public top-level categories with nested subcategories.';
