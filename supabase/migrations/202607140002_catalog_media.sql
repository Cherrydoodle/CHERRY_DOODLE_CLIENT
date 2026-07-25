do $$ begin
  create type public.product_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.product_badge as enum ('new', 'bestseller', 'sale');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.media_status as enum ('pending', 'ready', 'delete_pending', 'failed', 'deleted');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.media_purpose as enum ('product', 'category', 'hero', 'content', 'avatar');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.review_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  cloudflare_image_id text not null unique check (char_length(cloudflare_image_id) between 1 and 1024),
  purpose public.media_purpose not null,
  status public.media_status not null default 'pending',
  original_filename varchar(255),
  mime_type varchar(100),
  byte_size integer check (byte_size is null or byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  alt_text varchar(300) not null default '',
  require_signed_urls boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  ready_at timestamptz,
  last_error text,
  deletion_attempts smallint not null default 0 check (deletion_attempts >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 120),
  name varchar(120) not null check (char_length(trim(name)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  emoji varchar(32),
  image_media_id uuid references public.media_assets(id) on delete restrict,
  seo_title varchar(160),
  seo_description varchar(320),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (parent_id is null or parent_id <> id)
);

create table if not exists public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9]+(?:[.-][a-z0-9]+)*$'),
  eyebrow varchar(200),
  title varchar(200) not null,
  body text check (body is null or char_length(body) <= 2000),
  media_asset_id uuid references public.media_assets(id) on delete restrict,
  primary_label varchar(80),
  primary_href varchar(500),
  secondary_label varchar(80),
  secondary_href varchar(500),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 120),
  name varchar(160) not null check (char_length(trim(name)) between 2 and 160),
  label varchar(100) not null default '',
  description text not null check (char_length(description) between 1 and 5000),
  material varchar(255) not null default '',
  size varchar(255) not null default '',
  base_price_cents integer not null check (base_price_cents > 0),
  sale_price_cents integer check (sale_price_cents is null or (sale_price_cents > 0 and sale_price_cents < base_price_cents)),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status public.product_status not null default 'draft',
  featured_sort_order integer,
  aggregate_rating numeric(3,2) not null default 0 check (aggregate_rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  published_at timestamptz,
  version integer not null default 1 check (version > 0),
  search_document tsvector,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (status <> 'published' or published_at is not null)
);

create table if not exists public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

create table if not exists public.colors (
  id uuid primary key default gen_random_uuid(),
  name extensions.citext not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  hex_code char(7) not null check (hex_code ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  color_id uuid not null references public.colors(id) on delete restrict,
  sku extensions.citext not null unique check (char_length(sku::text) between 1 and 80),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.product_media (
  product_id uuid not null references public.products(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete restrict,
  position smallint not null check (position between 0 and 99),
  is_primary boolean not null default false,
  alt_text_override varchar(300),
  created_at timestamptz not null default now(),
  primary key (product_id, media_asset_id)
);

create table if not exists public.product_badges (
  product_id uuid not null references public.products(id) on delete cascade,
  badge public.product_badge not null,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (product_id, badge)
);

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  title varchar(160),
  body text check (body is null or char_length(body) <= 5000),
  status public.review_status not null default 'pending',
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public.validate_category_tree()
returns trigger language plpgsql set search_path = '' as $$
declare parent_parent uuid;
begin
  if new.parent_id is null then return new; end if;
  select parent_id into parent_parent from public.categories where id = new.parent_id and deleted_at is null;
  if not found then raise exception 'CATEGORY_PARENT_INVALID'; end if;
  if parent_parent is not null then raise exception 'CATEGORY_DEPTH_EXCEEDED'; end if;
  if exists (select 1 from public.categories where parent_id = new.id and deleted_at is null) then
    raise exception 'CATEGORY_WITH_CHILDREN_CANNOT_BECOME_CHILD';
  end if;
  return new;
end; $$;

drop trigger if exists categories_validate_tree on public.categories;
create trigger categories_validate_tree before insert or update of parent_id on public.categories
for each row execute function public.validate_category_tree();

create or replace function public.set_product_search_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.search_document :=
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(new.name, ''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(new.label, ''))), 'B') ||
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(new.description, ''))), 'C');
  return new;
end; $$;

drop trigger if exists products_search_document on public.products;
create trigger products_search_document before insert or update of name, label, description on public.products
for each row execute function public.set_product_search_document();

create or replace function public.refresh_product_review_aggregate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_product uuid;
begin
  target_product := coalesce(new.product_id, old.product_id);
  update public.products p set
    aggregate_rating = coalesce((select round(avg(r.rating)::numeric, 2) from public.product_reviews r where r.product_id = target_product and r.status = 'approved' and r.deleted_at is null), 0),
    review_count = (select count(*) from public.product_reviews r where r.product_id = target_product and r.status = 'approved' and r.deleted_at is null)
  where p.id = target_product;
  return coalesce(new, old);
end; $$;

drop trigger if exists product_reviews_refresh_aggregate on public.product_reviews;
create trigger product_reviews_refresh_aggregate after insert or update of rating, status, deleted_at or delete on public.product_reviews
for each row execute function public.refresh_product_review_aggregate();

do $$
declare table_name text;
begin
  foreach table_name in array array['media_assets','categories','content_blocks','products','colors','product_variants','product_reviews'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_touch_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', table_name || '_touch_updated_at', table_name);
  end loop;
  foreach table_name in array array['media_assets','categories','content_blocks','products','product_variants'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_increment_version', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.increment_version()', table_name || '_increment_version', table_name);
  end loop;
end $$;

create unique index if not exists product_categories_one_primary_idx on public.product_categories(product_id) where is_primary;
create index if not exists product_categories_category_idx on public.product_categories(category_id, product_id);
create unique index if not exists product_variants_active_color_idx on public.product_variants(product_id, color_id) where deleted_at is null;
create index if not exists product_variants_product_idx on public.product_variants(product_id, is_active, sort_order) where deleted_at is null;
create unique index if not exists product_media_one_primary_idx on public.product_media(product_id) where is_primary;
create unique index if not exists product_media_position_idx on public.product_media(product_id, position);
create index if not exists product_media_asset_idx on public.product_media(media_asset_id);
create unique index if not exists product_reviews_one_per_user_idx on public.product_reviews(product_id, user_id) where deleted_at is null;
create index if not exists products_search_idx on public.products using gin(search_document);
-- Schema-qualified: pg_trgm lives in the `extensions` schema, which is not on the
-- search_path of the role the Supabase CLI uses to apply migrations to a hosted
-- project. Unqualified `gin_trgm_ops` fails there with SQLSTATE 42704.
create index if not exists products_name_trgm_idx on public.products using gin(lower(name) extensions.gin_trgm_ops);
create index if not exists products_public_newest_idx on public.products(published_at desc, id) where status = 'published' and deleted_at is null;
create index if not exists products_public_price_idx on public.products(base_price_cents, id) where status = 'published' and deleted_at is null;
create index if not exists products_public_rating_idx on public.products(aggregate_rating desc, id) where status = 'published' and deleted_at is null;
create index if not exists products_featured_idx on public.products(featured_sort_order, id) where featured_sort_order is not null and status = 'published' and deleted_at is null;
create index if not exists products_sale_idx on public.products(sale_price_cents, id) where sale_price_cents is not null and status = 'published' and deleted_at is null;
create index if not exists categories_parent_sort_idx on public.categories(parent_id, sort_order) where is_active and deleted_at is null;
create index if not exists media_assets_status_created_idx on public.media_assets(status, created_at);
create index if not exists content_blocks_schedule_idx on public.content_blocks(key, starts_at, ends_at) where is_active and deleted_at is null;
