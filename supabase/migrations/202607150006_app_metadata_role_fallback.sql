-- Hosted projects should enable public.custom_access_token_hook. This fallback
-- also accepts the service-managed app_metadata role so a staff account remains
-- usable before the project-level hook is enabled. Users cannot edit app_metadata.

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
    where rp.role = coalesce(
      nullif(auth.jwt() ->> 'app_role', '')::public.app_role,
      nullif(auth.jwt() -> 'app_metadata' ->> 'app_role', '')::public.app_role,
      'customer'::public.app_role
    )
      and rp.permission = requested_permission
  );
$$;
