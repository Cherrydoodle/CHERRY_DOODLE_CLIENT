-- Creating a product, its first variant, and its primary image used to be three-to-four
-- separate client-orchestrated requests with no rollback: a mid-sequence failure left an
-- orphaned draft (product with no variant/image), and retrying hit a slug conflict because
-- the product row already existed. This function does the multi-table insert in one
-- transaction so a product is either fully formed (product + category + variant, media
-- optional) or not created at all.

create or replace function public.create_product_with_variant(
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

  insert into public.product_variants (product_id, color_id, sku, stock_quantity, low_stock_threshold)
  values (v_product_id, p_color_id, p_sku, p_stock_quantity, p_low_stock_threshold);

  if p_media_id is not null then
    insert into public.product_media (product_id, media_asset_id, position, is_primary)
    values (v_product_id, p_media_id, 0, true);
  end if;

  return v_product_id;
end;
$$;

revoke all on function public.create_product_with_variant(
  text, varchar, varchar, text, varchar, varchar, integer, integer, integer, boolean,
  uuid, public.product_badge[], uuid, text, integer, integer, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_product_with_variant(
  text, varchar, varchar, text, varchar, varchar, integer, integer, integer, boolean,
  uuid, public.product_badge[], uuid, text, integer, integer, uuid, uuid
) to service_role;
