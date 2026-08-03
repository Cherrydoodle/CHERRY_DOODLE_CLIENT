-- Delhivery courier integration: shipments (one waybill per order, matching the
-- existing single-parcel model from 202607210002_order_delivery_tracking.sql),
-- their scan history, and a pincode-serviceability cache so checkout does not hit
-- Delhivery's API on every request. Reuses the existing orders.read/orders.write
-- permissions -- order management is already admin-only (src/lib/auth-role.ts in
-- the admin panel), so a separate shipments.* permission would buy nothing.

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider varchar(20) not null default 'delhivery' check (provider = 'delhivery'),
  waybill varchar(50) not null unique,
  payment_mode varchar(10) not null default 'Prepaid' check (payment_mode in ('Prepaid', 'COD')),
  status varchar(60),
  status_type varchar(8),
  nsl_code varchar(20),
  status_location varchar(200),
  status_instructions text,
  status_at timestamptz,
  weight_grams integer not null check (weight_grams > 0 and weight_grams <= 50000),
  length_cm integer not null check (length_cm > 0 and length_cm <= 200),
  breadth_cm integer not null check (breadth_cm > 0 and breadth_cm <= 200),
  height_cm integer not null check (height_cm > 0 and height_cm <= 200),
  declared_value_minor integer not null check (declared_value_minor >= 0),
  pickup_location varchar(120) not null,
  manifested_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  last_synced_at timestamptz,
  sync_attempts integer not null default 0 check (sync_attempts >= 0),
  last_error text,
  raw_manifest_response jsonb,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

-- One live parcel per order, matching the "no separate shipments table" comment
-- this migration otherwise supersedes: the constraint that made that true (one
-- parcel per order) is preserved as a partial unique index instead.
create unique index if not exists shipments_one_live_per_order_idx
  on public.shipments(order_id) where deleted_at is null and cancelled_at is null;

-- The tracking cron's only query path: stalest non-terminal shipments first.
create index if not exists shipments_sync_idx
  on public.shipments(last_synced_at nulls first)
  where delivered_at is null and cancelled_at is null and deleted_at is null;

create table if not exists public.shipment_scans (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  scan_status varchar(60) not null,
  scan_type varchar(8),
  scan_location varchar(200),
  scan_instructions text,
  nsl_code varchar(20),
  scanned_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Lets both the pull job and a pushed webhook delivery insert the same scan
  -- without creating a duplicate row (on conflict do nothing on this key).
  unique (shipment_id, scanned_at, scan_status)
);

create index if not exists shipment_scans_shipment_idx
  on public.shipment_scans(shipment_id, scanned_at desc);

create table if not exists public.pincode_serviceability (
  postal_code char(6) primary key check (postal_code ~ '^[1-9][0-9]{5}$'),
  is_serviceable boolean not null,
  prepaid boolean,
  cod boolean,
  city varchar(100),
  state_code varchar(10),
  district varchar(100),
  max_amount numeric,
  checked_at timestamptz not null default now()
);

-- Nullable: falls back to DELHIVERY_DEFAULT_PARCEL_WEIGHT_GRAMS when unset, so
-- existing products need no immediate backfill.
alter table public.product_variants
  add column if not exists weight_grams integer check (weight_grams is null or (weight_grams > 0 and weight_grams <= 50000));

do $$
declare table_name text;
begin
  foreach table_name in array array['shipments'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_touch_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', table_name || '_touch_updated_at', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_increment_version', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.increment_version()', table_name || '_increment_version', table_name);
  end loop;
end $$;

alter table public.shipments enable row level security;
alter table public.shipment_scans enable row level security;
alter table public.pincode_serviceability enable row level security;

create policy shipments_select_own on public.shipments for select to authenticated
using (exists (
  select 1 from public.orders o where o.id = order_id and o.deleted_at is null
  and (o.customer_user_id = (select auth.uid()) or (select public.authorize('orders.read')))
) and deleted_at is null);
create policy shipments_admin_write on public.shipments for all to authenticated
using ((select public.authorize('orders.write')))
with check ((select public.authorize('orders.write')));

create policy shipment_scans_select_own on public.shipment_scans for select to authenticated
using (exists (
  select 1 from public.shipments s join public.orders o on o.id = s.order_id
  where s.id = shipment_id and s.deleted_at is null and o.deleted_at is null
  and (o.customer_user_id = (select auth.uid()) or (select public.authorize('orders.read')))
));

revoke all on public.pincode_serviceability from public, anon, authenticated;
grant select on public.pincode_serviceability to service_role;

grant select on public.shipments, public.shipment_scans to authenticated;
grant insert, update, delete on public.shipments to authenticated;
