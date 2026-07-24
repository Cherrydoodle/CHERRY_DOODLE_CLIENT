create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

do $$ begin
  create type public.app_role as enum ('customer', 'catalog_manager', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.app_permission as enum (
    'catalog.write',
    'catalog.publish',
    'media.write',
    'content.write',
    'newsletter.read',
    'users.manage_roles',
    'audit.read',
    'system.cleanup'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(80) not null check (char_length(trim(display_name)) between 2 and 80),
  locale varchar(10) not null default 'en' check (locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer',
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role public.app_role not null,
  permission public.app_permission not null,
  primary key (role, permission)
);

insert into public.role_permissions (role, permission) values
  ('catalog_manager', 'catalog.write'),
  ('catalog_manager', 'catalog.publish'),
  ('catalog_manager', 'media.write'),
  ('catalog_manager', 'content.write'),
  ('admin', 'catalog.write'),
  ('admin', 'catalog.publish'),
  ('admin', 'media.write'),
  ('admin', 'content.write'),
  ('admin', 'newsletter.read'),
  ('admin', 'users.manage_roles'),
  ('admin', 'audit.read'),
  ('admin', 'system.cleanup')
on conflict do nothing;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.increment_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  insert into public.profiles (user_id, display_name, marketing_consent_at)
  values (
    new.id,
    left(coalesce(requested_name, 'Cherry Doodle customer'), 80),
    case when coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false) then now() else null end
  )
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.authorize(requested_permission public.app_permission)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_permissions rp
    where rp.role = coalesce((auth.jwt() ->> 'app_role')::public.app_role, 'customer'::public.app_role)
      and rp.permission = requested_permission
  );
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  assigned_role public.app_role;
begin
  select ur.role into assigned_role
  from public.user_roles ur
  where ur.user_id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{app_role}', to_jsonb(coalesce(assigned_role, 'customer'::public.app_role)));
  return jsonb_build_object('claims', claims);
end;
$$;

revoke execute on function public.authorize(public.app_permission) from public, anon;
grant execute on function public.authorize(public.app_permission) to authenticated;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.user_roles to supabase_auth_admin;

create index if not exists profiles_deleted_at_idx on public.profiles(deleted_at) where deleted_at is not null;
create index if not exists user_roles_role_idx on public.user_roles(role);
