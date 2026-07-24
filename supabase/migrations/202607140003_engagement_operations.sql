do $$ begin
  create type public.cart_status as enum ('active', 'merged', 'abandoned', 'converted');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.newsletter_status as enum ('pending', 'active', 'unsubscribed', 'suppressed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.webhook_status as enum ('received', 'processed', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  guest_token_hash text,
  status public.cart_status not null default 'active',
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  expires_at timestamptz,
  merged_into_cart_id uuid references public.carts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or ((user_id is not null)::integer + (guest_token_hash is not null)::integer = 1)),
  check (status <> 'merged' or merged_into_cart_id is not null)
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity smallint not null check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_variant_id)
);

create table if not exists public.wishlist_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.newsletter_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique,
  status public.newsletter_status not null default 'pending',
  source varchar(100) not null default 'footer',
  confirmation_token_hash text unique,
  unsubscribe_token_hash text unique,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  last_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role public.app_role,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id uuid not null,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  subject_hash text not null,
  key varchar(100) not null,
  request_hash text not null,
  response_status smallint,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (scope, subject_hash, key)
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider varchar(50) not null,
  event_key text not null unique,
  payload_hash text not null,
  status public.webhook_status not null default 'received',
  attempts smallint not null default 0 check (attempts >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

drop trigger if exists carts_touch_updated_at on public.carts;
create trigger carts_touch_updated_at before update on public.carts for each row execute function public.touch_updated_at();
drop trigger if exists cart_items_touch_updated_at on public.cart_items;
create trigger cart_items_touch_updated_at before update on public.cart_items for each row execute function public.touch_updated_at();
drop trigger if exists newsletter_subscriptions_touch_updated_at on public.newsletter_subscriptions;
create trigger newsletter_subscriptions_touch_updated_at before update on public.newsletter_subscriptions for each row execute function public.touch_updated_at();

create unique index if not exists carts_one_active_user_idx on public.carts(user_id) where status = 'active' and user_id is not null;
create unique index if not exists carts_one_active_guest_idx on public.carts(guest_token_hash) where status = 'active' and guest_token_hash is not null;
create index if not exists carts_expiry_idx on public.carts(expires_at) where status = 'active' and expires_at is not null;
create index if not exists cart_items_cart_idx on public.cart_items(cart_id);
create index if not exists cart_items_variant_idx on public.cart_items(product_variant_id);
create index if not exists wishlist_user_created_idx on public.wishlist_items(user_id, created_at desc);
create index if not exists newsletter_status_created_idx on public.newsletter_subscriptions(status, created_at);
create index if not exists audit_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_actor_created_idx on public.audit_logs(actor_user_id, created_at desc);
create index if not exists audit_resource_created_idx on public.audit_logs(resource_type, resource_id, created_at desc);
create index if not exists idempotency_expiry_idx on public.idempotency_keys(expires_at);
create index if not exists webhook_status_received_idx on public.webhook_events(status, received_at);
