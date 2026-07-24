do $$ begin
  create type public.order_status as enum ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
exception when duplicate_object then null; end $$;

insert into public.role_permissions (role, permission) values
  ('catalog_manager', 'dashboard.read'),
  ('catalog_manager', 'settings.read'),
  ('admin', 'dashboard.read'),
  ('admin', 'orders.read'),
  ('admin', 'orders.write'),
  ('admin', 'customers.read'),
  ('admin', 'settings.read'),
  ('admin', 'settings.write')
on conflict do nothing;

alter table public.profiles
  add column if not exists phone_number varchar(32),
  add column if not exists avatar_media_id uuid references public.media_assets(id) on delete restrict,
  add column if not exists account_status varchar(20) not null default 'active'
    check (account_status in ('active', 'suspended'));

alter table public.products
  add column if not exists allow_custom_image boolean not null default false;

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label varchar(50) not null default 'Shipping',
  recipient_name varchar(120) not null,
  phone_number varchar(32) not null,
  line1 varchar(200) not null,
  line2 varchar(200),
  city varchar(100) not null,
  state varchar(100) not null,
  postal_code varchar(24) not null,
  country_code char(2) not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  is_default boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.store_settings (
  singleton boolean primary key default true check (singleton),
  store_name varchar(120) not null,
  phone_number varchar(32) not null,
  email extensions.citext not null,
  website varchar(500) not null,
  address text not null check (char_length(address) between 5 and 1000),
  default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  locale varchar(10) not null default 'en' check (locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  timezone varchar(100) not null default 'UTC',
  logo_media_id uuid references public.media_assets(id) on delete restrict,
  favicon_media_id uuid references public.media_assets(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.store_settings (
  singleton, store_name, phone_number, email, website, address, default_currency, locale, timezone
) values (
  true, 'Cherry Doodle', '+1 000 000 0000', 'hello@example.com', 'https://example.com',
  'Configure the production store address in the admin panel.', 'USD', 'en', 'UTC'
) on conflict (singleton) do nothing;

create sequence if not exists public.order_number_seq start with 10001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number varchar(32) not null unique default ('CD-' || lpad(nextval('public.order_number_seq')::text, 6, '0')),
  customer_user_id uuid references auth.users(id) on delete set null,
  customer_name varchar(120) not null,
  customer_email extensions.citext not null,
  customer_phone varchar(32) not null,
  shipping_address jsonb not null check (jsonb_typeof(shipping_address) = 'object'),
  status public.order_status not null default 'pending',
  source varchar(20) not null default 'manual' check (source in ('manual', 'import', 'checkout')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor integer not null check (subtotal_minor >= 0),
  discount_minor integer not null default 0 check (discount_minor >= 0),
  shipping_minor integer not null default 0 check (shipping_minor >= 0),
  tax_minor integer not null default 0 check (tax_minor >= 0),
  total_minor integer not null check (total_minor >= 0),
  customer_note text check (customer_note is null or char_length(customer_note) <= 2000),
  placed_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  check (total_minor = subtotal_minor - discount_minor + shipping_minor + tax_minor),
  check (status <> 'delivered' or fulfilled_at is not null),
  check (status <> 'cancelled' or cancelled_at is not null)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_variant_id uuid references public.product_variants(id) on delete set null,
  product_name varchar(200) not null,
  sku varchar(80),
  quantity smallint not null check (quantity between 1 and 99),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  line_total_minor integer not null check (line_total_minor >= 0),
  created_at timestamptz not null default now(),
  check (line_total_minor = unit_price_minor * quantity)
);

create table if not exists public.order_item_customizations (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  media_asset_id uuid references public.media_assets(id) on delete restrict,
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  reason varchar(500),
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.order_internal_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  author_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses(user_id) where is_default and deleted_at is null;
create index if not exists customer_addresses_user_idx
  on public.customer_addresses(user_id, created_at desc) where deleted_at is null;
create index if not exists profiles_account_status_idx
  on public.profiles(account_status) where deleted_at is null;
create index if not exists orders_placed_idx
  on public.orders(placed_at desc, id) where deleted_at is null;
create index if not exists orders_status_placed_idx
  on public.orders(status, placed_at desc, id) where deleted_at is null;
create index if not exists orders_customer_idx
  on public.orders(customer_user_id, placed_at desc) where deleted_at is null;
create index if not exists orders_customer_email_idx
  on public.orders(customer_email, placed_at desc) where deleted_at is null;
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_customizations_item_idx on public.order_item_customizations(order_item_id);
create index if not exists order_history_order_idx on public.order_status_history(order_id, created_at desc);
create index if not exists order_notes_order_idx
  on public.order_internal_notes(order_id, created_at desc) where deleted_at is null;

drop trigger if exists customer_addresses_touch_updated_at on public.customer_addresses;
create trigger customer_addresses_touch_updated_at before update on public.customer_addresses
for each row execute function public.touch_updated_at();
drop trigger if exists customer_addresses_increment_version on public.customer_addresses;
create trigger customer_addresses_increment_version before update on public.customer_addresses
for each row execute function public.increment_version();

drop trigger if exists store_settings_touch_updated_at on public.store_settings;
create trigger store_settings_touch_updated_at before update on public.store_settings
for each row execute function public.touch_updated_at();
drop trigger if exists store_settings_increment_version on public.store_settings;
create trigger store_settings_increment_version before update on public.store_settings
for each row execute function public.increment_version();

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at before update on public.orders
for each row execute function public.touch_updated_at();
drop trigger if exists orders_increment_version on public.orders;
create trigger orders_increment_version before update on public.orders
for each row execute function public.increment_version();

drop trigger if exists order_customizations_touch_updated_at on public.order_item_customizations;
create trigger order_customizations_touch_updated_at before update on public.order_item_customizations
for each row execute function public.touch_updated_at();
drop trigger if exists order_customizations_increment_version on public.order_item_customizations;
create trigger order_customizations_increment_version before update on public.order_item_customizations
for each row execute function public.increment_version();

drop trigger if exists order_notes_touch_updated_at on public.order_internal_notes;
create trigger order_notes_touch_updated_at before update on public.order_internal_notes
for each row execute function public.touch_updated_at();

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_expected_version integer,
  p_new_status public.order_status,
  p_actor_id uuid,
  p_reason varchar default null
)
returns public.orders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_order public.orders;
  updated_order public.orders;
begin
  select * into current_order from public.orders where id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if current_order.status = p_new_status then return current_order; end if;
  if not (
    (current_order.status = 'pending' and p_new_status in ('processing', 'cancelled')) or
    (current_order.status = 'processing' and p_new_status in ('shipped', 'cancelled')) or
    (current_order.status = 'shipped' and p_new_status = 'delivered')
  ) then raise exception 'INVALID_ORDER_TRANSITION'; end if;

  update public.orders set
    status = p_new_status,
    fulfilled_at = case when p_new_status = 'delivered' then now() else fulfilled_at end,
    cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end,
    updated_by = p_actor_id
  where id = p_order_id and version = p_expected_version
  returning * into updated_order;

  insert into public.order_status_history(order_id, from_status, to_status, reason, changed_by)
  values (p_order_id, current_order.status, p_new_status, p_reason, p_actor_id);
  return updated_order;
end;
$$;

create or replace function public.list_admin_customers(
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
  avatar_cloudflare_image_id text,
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
      ma.cloudflare_image_id as avatar_cloudflare_image_id,
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
      p.avatar_media_id, ma.cloudflare_image_id, ma.alt_text, ma.width, ma.height, address.value
  )
  select filtered.*, count(*) over() as total_count
  from filtered
  order by joined_at desc, user_id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

alter table public.customer_addresses enable row level security;
alter table public.store_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_customizations enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_internal_notes enable row level security;

create policy profiles_customer_admin_select on public.profiles for select to authenticated
using ((select public.authorize('customers.read')));

create policy customer_addresses_select_own on public.customer_addresses for select to authenticated
using ((select auth.uid()) = user_id and deleted_at is null);
create policy customer_addresses_admin_select on public.customer_addresses for select to authenticated
using ((select public.authorize('customers.read')) and deleted_at is null);

create policy store_settings_staff_select on public.store_settings for select to authenticated
using ((select public.authorize('settings.read')));
create policy store_settings_admin_update on public.store_settings for update to authenticated
using ((select public.authorize('settings.write')))
with check ((select public.authorize('settings.write')));

create policy orders_select_own on public.orders for select to authenticated
using ((select auth.uid()) = customer_user_id and deleted_at is null);
create policy orders_admin_select on public.orders for select to authenticated
using ((select public.authorize('orders.read')) and deleted_at is null);
create policy orders_admin_update on public.orders for update to authenticated
using ((select public.authorize('orders.write')))
with check ((select public.authorize('orders.write')));

create policy order_items_select on public.order_items for select to authenticated
using (exists (
  select 1 from public.orders o where o.id = order_id and o.deleted_at is null
  and (o.customer_user_id = (select auth.uid()) or (select public.authorize('orders.read')))
));
create policy order_customizations_select on public.order_item_customizations for select to authenticated
using (exists (
  select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
  where oi.id = order_item_id and o.deleted_at is null
  and (o.customer_user_id = (select auth.uid()) or (select public.authorize('orders.read')))
));
create policy order_history_select on public.order_status_history for select to authenticated
using (exists (
  select 1 from public.orders o where o.id = order_id and o.deleted_at is null
  and (o.customer_user_id = (select auth.uid()) or (select public.authorize('orders.read')))
));
create policy order_notes_admin_select on public.order_internal_notes for select to authenticated
using ((select public.authorize('orders.read')) and deleted_at is null);

grant select on public.customer_addresses, public.store_settings, public.orders, public.order_items,
  public.order_item_customizations, public.order_status_history to authenticated;
grant update on public.store_settings, public.orders to authenticated;
grant select on public.order_internal_notes to authenticated;
revoke all on function public.transition_order_status(uuid, integer, public.order_status, uuid, varchar) from public, anon, authenticated;
grant execute on function public.transition_order_status(uuid, integer, public.order_status, uuid, varchar) to service_role;
revoke all on function public.list_admin_customers(text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_admin_customers(text, integer, integer) to service_role;
