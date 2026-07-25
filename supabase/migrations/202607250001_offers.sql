do $$ begin
  create type public.offer_pricing_mode as enum ('percentage', 'fixed');
exception when duplicate_object then null; end $$;

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  name varchar(160) not null check (char_length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 120),
  pricing_mode public.offer_pricing_mode not null default 'percentage',
  discount_percent numeric(5,2) check (discount_percent is null or (discount_percent > 0 and discount_percent <= 95)),
  banner_media_id uuid references public.media_assets(id) on delete restrict,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  priority integer not null default 0,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (pricing_mode <> 'percentage' or discount_percent is not null)
);

create table if not exists public.offer_products (
  offer_id uuid not null references public.offers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  offer_price_cents integer check (offer_price_cents is null or offer_price_cents > 0),
  created_at timestamptz not null default now(),
  primary key (offer_id, product_id)
);

do $$
declare table_name text;
begin
  foreach table_name in array array['offers'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_touch_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', table_name || '_touch_updated_at', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_increment_version', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.increment_version()', table_name || '_increment_version', table_name);
  end loop;
end $$;

create index if not exists offers_active_priority_idx on public.offers(priority desc, id) where is_active and deleted_at is null;
create index if not exists offers_schedule_idx on public.offers(starts_at, ends_at) where is_active and deleted_at is null;
create index if not exists offer_products_product_idx on public.offer_products(product_id, offer_id);

alter table public.offers enable row level security;
alter table public.offer_products enable row level security;

create policy offers_public_select on public.offers for select to anon, authenticated
using (is_active and deleted_at is null and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy offers_admin_all on public.offers for all to authenticated
using ((select public.authorize('catalog.write')))
with check ((select public.authorize('catalog.write')));

create policy offer_products_public_select on public.offer_products for select to anon, authenticated
using (exists (
  select 1 from public.offers o
  where o.id = offer_id and o.is_active and o.deleted_at is null
    and (o.starts_at is null or o.starts_at <= now()) and (o.ends_at is null or o.ends_at > now())
));
create policy offer_products_admin_all on public.offer_products for all to authenticated
using ((select public.authorize('catalog.write')))
with check ((select public.authorize('catalog.write')));

grant select on public.offers, public.offer_products to anon, authenticated;
grant insert, update, delete on public.offers, public.offer_products to authenticated;

comment on table public.offers is 'Scheduled percentage/fixed-price discount campaigns applied to a set of products.';
comment on table public.offer_products is 'Junction of products included in an offer; offer_price_cents is set only in fixed pricing_mode.';
