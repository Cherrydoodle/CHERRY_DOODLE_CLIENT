-- Email/password registration explicitly sets user_metadata.display_name
-- (features/auth/service.ts), but Google OAuth populates user_metadata with
-- full_name/name instead -- handle_new_user() only ever looked for display_name,
-- so every first-time Google sign-in silently fell back to the hardcoded
-- "Cherry Doodle customer" placeholder. This adds a fallback chain; the display
-- name remains editable afterward via PATCH /api/v1/me (features/auth/service.ts).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  )), '');
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
