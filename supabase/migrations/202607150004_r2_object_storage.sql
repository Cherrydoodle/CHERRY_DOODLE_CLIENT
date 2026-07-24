-- Replace Cloudflare Images provider identifiers with Cloudflare R2 object keys.
-- Rows created before this migration are retained as legacy provider records and
-- must be re-uploaded to R2 before they can be served by the updated application.

alter table public.media_assets
  add column storage_provider varchar(32) not null default 'legacy_cloudflare_images'
    check (storage_provider in ('r2', 'legacy_cloudflare_images')),
  add column storage_etag text;

alter table public.media_assets
  alter column storage_provider set default 'r2';

alter table public.media_assets
  rename column cloudflare_image_id to storage_key;

comment on column public.media_assets.storage_key is
  'Provider object key. R2 rows use an application-generated key, never a public URL.';
comment on column public.media_assets.storage_provider is
  'r2 for current objects; legacy_cloudflare_images identifies pre-migration rows requiring re-upload.';
comment on column public.media_assets.storage_etag is
  'Provider ETag captured when an R2 upload is finalized.';

alter view public.public_product_cards rename column cloudflare_image_id to storage_key;
alter view public.public_category_tree rename column cloudflare_image_id to storage_key;

drop function if exists public.list_admin_customers(text, integer, integer);

create function public.list_admin_customers(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  display_name varchar,
  email extensions.citext,
  phone_number varchar,
  account_status varchar,
  joined_at timestamptz,
  avatar_media_id uuid,
  avatar_storage_key text,
  avatar_alt_text varchar,
  avatar_width integer,
  avatar_height integer,
  default_address jsonb,
  order_count bigint,
  last_order_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select
      p.user_id,
      p.display_name,
      u.email::extensions.citext as email,
      p.phone_number,
      p.account_status,
      p.created_at as joined_at,
      p.avatar_media_id,
      ma.storage_key as avatar_storage_key,
      ma.alt_text as avatar_alt_text,
      ma.width as avatar_width,
      ma.height as avatar_height,
      address.value as default_address,
      count(o.id) as order_count,
      max(o.placed_at) as last_order_at
    from public.profiles p
    join auth.users u on u.id = p.user_id
    join public.user_roles ur on ur.user_id = p.user_id and ur.role = 'customer'
    left join public.media_assets ma on ma.id = p.avatar_media_id and ma.status = 'ready' and ma.deleted_at is null
    left join lateral (
      select jsonb_build_object(
        'id', a.id, 'label', a.label, 'recipientName', a.recipient_name, 'phoneNumber', a.phone_number,
        'line1', a.line1, 'line2', a.line2, 'city', a.city, 'state', a.state,
        'postalCode', a.postal_code, 'countryCode', a.country_code
      ) as value
      from public.customer_addresses a
      where a.user_id = p.user_id and a.deleted_at is null
      order by a.is_default desc, a.updated_at desc
      limit 1
    ) address on true
    left join public.orders o on o.customer_user_id = p.user_id and o.deleted_at is null
    where p.deleted_at is null and (
      nullif(trim(p_query), '') is null
      or p.display_name ilike '%' || trim(p_query) || '%'
      or u.email ilike '%' || trim(p_query) || '%'
      or coalesce(p.phone_number, '') ilike '%' || trim(p_query) || '%'
    )
    group by p.user_id, p.display_name, u.email, p.phone_number, p.account_status, p.created_at,
      p.avatar_media_id, ma.storage_key, ma.alt_text, ma.width, ma.height, address.value
  )
  select filtered.*, count(*) over() as total_count
  from filtered
  order by joined_at desc, user_id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.list_admin_customers(text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_admin_customers(text, integer, integer) to service_role;
